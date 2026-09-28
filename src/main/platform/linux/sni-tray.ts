import { CString, JSCallback, type Pointer, ptr, toArrayBuffer } from 'bun:ffi';
import type { TrayBackend, TrayInstance } from '../../api/tray';
import { cstr } from '../cstr';
import {
  DBUS_GET_PROPERTY_CB_DEF,
  DBUS_METHOD_CALL_CB_DEF,
  loadGDBusFFI,
  VTABLE_SLOTS,
} from './gdbus-ffi';
import { loadGdkPixbufFFI } from './gdk-pixbuf-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';
import {
  callMethodSync,
  emitSignal,
  nodeInfoLookupInterface,
  nodeInfoNewForXml,
  probeSessionBusUnchecked,
  registerObject,
  subscribeSignal,
  unregisterObject,
} from './linux-dbus';

/**
 * Tray as a StatusNotifierItem on the session bus, gated by BUNMASKA_ENABLE_LINUX_TRAY (unset in
 * CI, which gets an inert tray). Create it on the pumped main thread (the linux-dbus THREAD
 * INVARIANT). The vtable JSCallbacks are retained forever and never closed: GDBus's copy of the
 * vtable holds their raw function pointers.
 */

const OBJECT_PATH_PREFIX = '/StatusNotifierItem';
const SNI_IFACE = 'org.kde.StatusNotifierItem';
const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';
const WATCHER_PATH = '/StatusNotifierWatcher';

/** Only served properties are declared, so GetAll never hits an unserved one. */
export const SNI_XML = `<node>
 <interface name="org.kde.StatusNotifierItem">
  <property name="Category" type="s" access="read"/>
  <property name="Id" type="s" access="read"/>
  <property name="Title" type="s" access="read"/>
  <property name="Status" type="s" access="read"/>
  <property name="IconName" type="s" access="read"/>
  <property name="IconPixmap" type="a(iiay)" access="read"/>
  <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
  <property name="Menu" type="o" access="read"/>
  <property name="ItemIsMenu" type="b" access="read"/>
  <method name="Activate"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
  <method name="SecondaryActivate"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
  <method name="ContextMenu"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
  <method name="Scroll"><arg name="delta" type="i" direction="in"/><arg name="orientation" type="s" direction="in"/></method>
  <signal name="NewIcon"/>
  <signal name="NewToolTip"/>
  <signal name="NewTitle"/>
  <signal name="NewStatus"><arg name="status" type="s"/></signal>
 </interface>
</node>`;

/** Unset in CI, which gets an inert tray. */
const liveTrayEnabled = (): boolean => process.env['BUNMASKA_ENABLE_LINUX_TRAY'] === '1';

// Never freed: the vtable JSCallbacks, node infos and vtable arrays of every registered tray.
const retained: {
  callbacks: JSCallback[];
  misc: unknown[];
} = { callbacks: [], misc: [] };

/** One `GVariantType*` per type string, never freed. */
const variantTypes = new Map<string, Pointer>();
const variantType = (typeString: string): Pointer => {
  const cached = variantTypes.get(typeString);
  if (cached !== undefined) {
    return cached;
  }
  const t = loadGlibFFI().symbols.g_variant_type_new(cstr(typeString));
  if (t === null) {
    throw new Error(`g_variant_type_new('${typeString}') returned null`);
  }
  variantTypes.set(typeString, t);
  return t;
};

/**
 * GdkPixbuf rows (RGB or RGBA, rowstride-padded) to packed ARGB32 in NETWORK byte order, the
 * IconPixmap wire format. Only pixel bytes are swapped: width and height stay native through
 * g_variant_new_int32. A 3-channel source gets A=0xFF.
 */
export const rgbaToArgb32Network = (
  pixels: Uint8Array,
  width: number,
  height: number,
  rowstride: number,
  nChannels: number,
): Uint8Array => {
  const out = new Uint8Array(width * height * 4);
  let o = 0;
  for (let y = 0; y < height; y++) {
    let p = y * rowstride;
    for (let x = 0; x < width; x++) {
      const r = pixels[p] ?? 0;
      const g = pixels[p + 1] ?? 0;
      const b = pixels[p + 2] ?? 0;
      const a = nChannels >= 4 ? (pixels[p + 3] ?? 0xff) : 0xff;
      out[o] = a;
      out[o + 1] = r;
      out[o + 2] = g;
      out[o + 3] = b;
      o += 4;
      p += nChannels;
    }
  }
  return out;
};

type Icon = { argb: Uint8Array; width: number; height: number };

/** Null when the file is unreadable. */
const decodeIcon = (path: string): Icon | null => {
  const pix = loadGdkPixbufFFI();
  const pixbuf = pix.symbols.gdk_pixbuf_new_from_file(cstr(path), null);
  if (pixbuf === null) {
    return null;
  }
  const width = pix.symbols.gdk_pixbuf_get_width(pixbuf);
  const height = pix.symbols.gdk_pixbuf_get_height(pixbuf);
  const rowstride = pix.symbols.gdk_pixbuf_get_rowstride(pixbuf);
  const nChannels = pix.symbols.gdk_pixbuf_get_n_channels(pixbuf);
  const pixelsPtr = pix.symbols.gdk_pixbuf_get_pixels(pixbuf);
  let icon: Icon | null = null;
  if (pixelsPtr !== null && width > 0 && height > 0) {
    const view = new Uint8Array(toArrayBuffer(pixelsPtr, 0, height * rowstride));
    icon = { argb: rgbaToArgb32Network(view, width, height, rowstride, nChannels), width, height };
  }
  loadGObjectFFI().symbols.g_object_unref(pixbuf); // the pixels were copied into `argb`
  return icon;
};

/** A floating one-frame `a(iiay)`; its `ay` is a copy of `icon.argb`. */
const buildIconPixmap = (icon: Icon): Pointer | null => {
  const g = loadGlibFFI().symbols;
  const builder = g.g_variant_builder_new(variantType('a(iiay)'));
  g.g_variant_builder_open(builder, variantType('(iiay)'));
  g.g_variant_builder_add_value(builder, g.g_variant_new_int32(icon.width));
  g.g_variant_builder_add_value(builder, g.g_variant_new_int32(icon.height));
  g.g_variant_builder_add_value(
    builder,
    g.g_variant_new_fixed_array(variantType('y'), ptr(icon.argb), BigInt(icon.argb.length), 1n),
  );
  g.g_variant_builder_close(builder);
  const value = g.g_variant_builder_end(builder);
  g.g_variant_builder_unref(builder);
  return value;
};

/** A floating `a(iiay)` with no frames. */
const buildEmptyPixmap = (): Pointer | null => {
  const g = loadGlibFFI().symbols;
  const builder = g.g_variant_builder_new(variantType('a(iiay)'));
  const value = g.g_variant_builder_end(builder);
  g.g_variant_builder_unref(builder);
  return value;
};

/** A floating `(sa(iiay)ss)`: (iconName, no pixmaps, title, description). */
const buildToolTip = (title: string, text: string): Pointer | null => {
  const g = loadGlibFFI().symbols;
  const builder = g.g_variant_builder_new(variantType('(sa(iiay)ss)'));
  g.g_variant_builder_add_value(builder, g.g_variant_new_string(cstr('')));
  g.g_variant_builder_add_value(builder, buildEmptyPixmap());
  g.g_variant_builder_add_value(builder, g.g_variant_new_string(cstr(title)));
  g.g_variant_builder_add_value(builder, g.g_variant_new_string(cstr(text)));
  const value = g.g_variant_builder_end(builder);
  g.g_variant_builder_unref(builder);
  return value;
};

/** Fill a getter's `GError**`: GDBus g_asserts (aborts) on a NULL Get value without one. */
const setGError = (out: Pointer | null, message: string): void => {
  if (out === null) {
    return; // GetAll passes NULL and skips the property.
  }
  const g = loadGlibFFI().symbols;
  const domain = g.g_quark_from_string(cstr('bunmaska-tray'));
  const gerror = g.g_error_new_literal(domain, 0, cstr(message));
  new BigUint64Array(toArrayBuffer(out, 0, 8))[0] = BigInt(gerror ?? 0);
};

/** A floating one-string tuple `(s)`, or null. */
const stringTuple = (value: string): Pointer | null => {
  const g = loadGlibFFI().symbols;
  const child = g.g_variant_new_string(cstr(value));
  return child === null
    ? null
    : g.g_variant_new_tuple(ptr(new BigUint64Array([BigInt(child)])), 1n);
};

/** For a disabled gate, a missing bus or a failed export; never touches the bus. */
const inertInstance = (): TrayInstance => {
  let destroyed = false;
  return {
    setToolTip: () => undefined,
    setTitle: () => undefined,
    setImage: () => undefined,
    setContextMenu: () => undefined,
    onClick: () => undefined,
    destroy: () => {
      destroyed = true;
    },
    isDestroyed: () => destroyed,
  };
};

type State = {
  readonly id: string;
  status: 'Active' | 'Passive';
  title: string;
  toolTip: string;
  icon: Icon | null;
  click: (() => void) | null;
};

/** A floating GVariant, or null for a name GDBus would already have rejected. */
const getPropertyValue = (state: State, name: string): Pointer | null => {
  const g = loadGlibFFI().symbols;
  switch (name) {
    case 'Category':
      return g.g_variant_new_string(cstr('ApplicationStatus'));
    case 'Id':
      return g.g_variant_new_string(cstr(state.id));
    case 'Title':
      return g.g_variant_new_string(cstr(state.title));
    case 'Status':
      return g.g_variant_new_string(cstr(state.status));
    case 'IconName':
      return g.g_variant_new_string(cstr(''));
    case 'IconPixmap':
      return state.icon === null ? buildEmptyPixmap() : buildIconPixmap(state.icon);
    case 'ToolTip':
      return buildToolTip(state.title, state.toolTip);
    case 'Menu':
      return g.g_variant_new_object_path(cstr('/NO_DBUSMENU'));
    case 'ItemIsMenu':
      return g.g_variant_new_boolean(0);
    default:
      return null;
  }
};

let trayCount = 0;

/** Null on any failure. */
const createLive = (conn: Pointer, initialImage: string, appName: string): TrayInstance | null => {
  const gdbus = loadGDBusFFI();
  // One object path per tray: a second registration at a shared path fails on one connection.
  const objectPath = `${OBJECT_PATH_PREFIX}/${trayCount++}`;
  const node = nodeInfoNewForXml(SNI_XML);
  if (node === null) {
    return null; // malformed XML
  }
  const iface = nodeInfoLookupInterface(node, SNI_IFACE);
  if (iface === null) {
    return null;
  }

  const state: State = {
    id: appName,
    status: 'Active',
    title: appName,
    toolTip: '',
    icon: decodeIcon(initialImage),
    click: null,
  };

  // Both handlers catch: a throw must not unwind into the GDBus dispatch.
  const getProp = new JSCallback((_c, _s, _p, _i, propName, error, _u): Pointer | null => {
    let value: Pointer | null = null;
    try {
      value = getPropertyValue(state, propName === null ? '' : new CString(propName).toString());
    } catch {
      value = null;
    }
    if (value === null) {
      setGError(error, 'StatusNotifierItem property unavailable');
    }
    return value;
  }, DBUS_GET_PROPERTY_CB_DEF);

  const methodCall = new JSCallback((_c, _s, _p, _i, method, _params, invocation, _u): void => {
    try {
      if ((method === null ? '' : new CString(method).toString()) === 'Activate') {
        state.click?.();
      }
    } catch {
      // A throwing click handler must not skip the reply below.
    }
    // Complete every method with an empty reply so the host is never left hanging.
    gdbus.symbols.g_dbus_method_invocation_return_value(invocation, null);
  }, DBUS_METHOD_CALL_CB_DEF);

  // Never registered, so native code holds neither: safe to close on the failure paths.
  const closeCallbacks = (): null => {
    methodCall.close();
    getProp.close();
    return null;
  };
  const mcPtr = methodCall.ptr;
  const gpPtr = getProp.ptr;
  if (mcPtr === null || gpPtr === null) {
    return closeCallbacks();
  }

  // [method_call, get_property, set_property = NULL, padding x8]: every property is read-only,
  // so GDBus rejects a Set before it would dispatch one.
  const vtable = new BigUint64Array(VTABLE_SLOTS);
  vtable[0] = BigInt(mcPtr);
  vtable[1] = BigInt(gpPtr);

  const regId = registerObject(conn, objectPath, iface, ptr(vtable));
  if (regId === 0) {
    return closeCallbacks();
  }
  retained.callbacks.push(methodCall, getProp); // load-bearing: the vtable copy points here.
  retained.misc.push(node, vtable);

  let destroyed = false;
  // Registered by object path: the watcher pairs it with our sender's unique name (the
  // libappindicator form). Absent watcher => fast null => the icon simply doesn't appear.
  const registerWithWatcher = (): void => {
    const args = stringTuple(objectPath);
    if (args === null) {
      return;
    }
    const reply = callMethodSync(
      conn,
      WATCHER_NAME,
      WATCHER_PATH,
      WATCHER_NAME,
      'RegisterStatusNotifierItem',
      args,
    );
    if (reply !== null) {
      loadGlibFFI().symbols.g_variant_unref(reply);
    }
  };
  registerWithWatcher();
  // A watcher that starts or restarts after us has no record of this item.
  subscribeSignal(
    conn,
    {
      sender: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'NameOwnerChanged',
      path: '/org/freedesktop/DBus',
      arg0: WATCHER_NAME,
    },
    () => {
      if (!destroyed) {
        registerWithWatcher();
      }
    },
  );

  return {
    setToolTip: (toolTip) => {
      state.toolTip = toolTip;
      emitSignal(conn, objectPath, SNI_IFACE, 'NewToolTip', null);
    },
    setTitle: (title) => {
      state.title = title;
      emitSignal(conn, objectPath, SNI_IFACE, 'NewTitle', null);
    },
    setImage: (image) => {
      state.icon = decodeIcon(image);
      emitSignal(conn, objectPath, SNI_IFACE, 'NewIcon', null); // argument-less; host re-fetches.
    },
    setContextMenu: () => undefined, // ponytail: no com.canonical.dbusmenu export, so a no-op.
    onClick: (callback) => {
      state.click = callback;
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      // Hosts keep an item until our connection closes; Passive hides it (as libappindicator does).
      state.status = 'Passive';
      const passive = stringTuple('Passive');
      if (passive !== null) {
        emitSignal(conn, objectPath, SNI_IFACE, 'NewStatus', passive);
      }
      unregisterObject(conn, regId); // do NOT close the callbacks (retained forever).
    },
    isDestroyed: () => destroyed,
  };
};

export const linuxTrayBackend: TrayBackend = {
  create: (image, _options, appName = 'Bunmaska') => {
    if (!liveTrayEnabled()) {
      return inertInstance();
    }
    const conn = probeSessionBusUnchecked();
    if (conn === null) {
      return inertInstance();
    }
    return createLive(conn, image, appName) ?? inertInstance();
  },
};
