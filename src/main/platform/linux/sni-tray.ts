import { CString, JSCallback, type Pointer, ptr, toArrayBuffer } from 'bun:ffi';
import type { TrayBackend, TrayInstance } from '../../api/tray';
import { cstr } from '../cstr';
import {
  DBUS_GET_PROPERTY_CB_DEF,
  DBUS_METHOD_CALL_CB_DEF,
  DBUS_SET_PROPERTY_CB_DEF,
  loadGDBusFFI,
  VTABLE_SLOTS,
} from './gdbus-ffi';
import { loadGdkPixbufFFI } from './gdk-pixbuf-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';
import {
  callMethodSync,
  emitSignal,
  getUniqueName,
  nodeInfoLookupInterface,
  nodeInfoNewForXml,
  probeSessionBusUnchecked,
  registerObject,
  unregisterObject,
} from './linux-dbus';

/**
 * Linux `Tray` via StatusNotifierItem (SNI) over D-Bus. We EXPORT an
 * `org.kde.StatusNotifierItem` object on the session bus (a host — KDE, the GNOME
 * AppIndicator extension, Waybar, swaybar — draws the icon by reading our properties), and
 * register it with `org.kde.StatusNotifierWatcher`.
 *
 * v1 ships icon + tooltip + LEFT-CLICK (the host's `Activate` → our `click`). The context
 * menu is DEFERRED: SNI's `Menu` points at a separate `com.canonical.dbusmenu` service
 * (another large export) — so `setContextMenu` is an accepted soft no-op on Linux v1 (it
 * does not throw; cross-platform callers that set a menu unconditionally still work).
 *
 * DEADLOCK/HANG-SAFE: the only blocking call is the bounded {@link callMethodSync} (5s); the
 * vtable callbacks fire on the GMainContext via the cooperative pump. CI-HANG-SAFE: gated
 * behind `BUNMASKA_ENABLE_LINUX_TRAY` (CI never sets it) → `create` returns an INERT no-op
 * instance, no bus touched, no object exported.
 *
 * LIFETIME (load-bearing, blind — verified by review, not CI): `register_object` COPIES the
 * vtable, so the live wires are the THREE JSCallbacks (the copied vtable holds their raw
 * fn-pointers) — they are retained FOREVER (never closed, mirroring the signal-subscription
 * discipline; closing would risk the in-flight-reply / own-invocation SIGSEGV class). The
 * `IconPixmap` is `g_variant_new_from_data(notify=NULL)`, so its backing ARGB `Uint8Array`
 * MUST outlive every reply that references it — every icon buffer is retained for the
 * process lifetime. Property getters MUST be on the pumped main thread (the THREAD INVARIANT
 * in linux-dbus.ts) or the host's queries dispatch to a context nothing iterates.
 */

const OBJECT_PATH = '/StatusNotifierItem';
const SNI_IFACE = 'org.kde.StatusNotifierItem';
const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';
const WATCHER_PATH = '/StatusNotifierWatcher';
const APP_ID = 'bunmaska';

/** The interface we export. Only properties we actually serve are declared (a host uses
 *  defaults for anything absent), so GetAll never hits an unserved property. */
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
 </interface>
</node>`;

/** Whether the live SNI path is enabled. CI leaves this unset → an inert no-op tray. */
const liveTrayEnabled = (): boolean => process.env['BUNMASKA_ENABLE_LINUX_TRAY'] === '1';

// Process-lifetime retains (never freed — see the module note): the vtable JSCallbacks
// (the copied vtable holds their raw fn-pointers) + every icon ARGB buffer (referenced by
// from_data variants with notify=NULL) + the node infos + vtable arrays.
const retained: {
  callbacks: JSCallback[];
  buffers: Uint8Array[];
  misc: unknown[];
} = { callbacks: [], buffers: [], misc: [] };

/** Cached `GVariantType*` per type string (allocated once, retained for the process). */
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
 * Convert GdkPixbuf rows (RGB or RGBA, `rowstride`-padded) to tightly-packed ARGB32 in
 * NETWORK (big-endian) byte order — the SNI IconPixmap wire format. PURE (no FFI): width/
 * height stay native (the `i` members go through g_variant_new_int32); only these pixel
 * bytes are pre-swapped. A 3-channel (no-alpha) source synthesizes A=0xFF.
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

/** Decode an icon file into ARGB32 pixels, or null if unreadable. Unrefs the pixbuf. */
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
  loadGObjectFFI().symbols.g_object_unref(pixbuf); // copied into `argb`; drop the pixbuf.
  return icon;
};

/** Build a floating `a(iiay)` with the one icon frame (retains `icon.argb` for from_data). */
const buildIconPixmap = (icon: Icon): Pointer | null => {
  const g = loadGlibFFI().symbols;
  retained.buffers.push(icon.argb); // referenced by from_data (notify=NULL) → must outlive the variant.
  const builder = g.g_variant_builder_new(variantType('a(iiay)'));
  g.g_variant_builder_open(builder, variantType('(iiay)'));
  g.g_variant_builder_add_value(builder, g.g_variant_new_int32(icon.width));
  g.g_variant_builder_add_value(builder, g.g_variant_new_int32(icon.height));
  g.g_variant_builder_add_value(
    builder,
    g.g_variant_new_from_data(
      variantType('ay'),
      ptr(icon.argb),
      BigInt(icon.argb.length),
      1,
      null,
      null,
    ),
  );
  g.g_variant_builder_close(builder);
  const value = g.g_variant_builder_end(builder);
  g.g_variant_builder_unref(builder);
  return value;
};

/** Build a floating empty `a(iiay)` (no frames). */
const buildEmptyPixmap = (): Pointer | null => {
  const g = loadGlibFFI().symbols;
  const builder = g.g_variant_builder_new(variantType('a(iiay)'));
  const value = g.g_variant_builder_end(builder);
  g.g_variant_builder_unref(builder);
  return value;
};

/** Build a floating `(sa(iiay)ss)` ToolTip = (iconName, [], title, description). */
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

/** A fully-inert no-op tray (gate off / no bus / export failed) — never touches the bus. */
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
  title: string;
  toolTip: string;
  icon: Icon | null;
  click: (() => void) | null;
};

/** Serve one SNI property as a floating GVariant, or null for an unknown name. */
const getPropertyValue = (state: State, name: string): Pointer | null => {
  const g = loadGlibFFI().symbols;
  switch (name) {
    case 'Category':
      return g.g_variant_new_string(cstr('ApplicationStatus'));
    case 'Id':
      return g.g_variant_new_string(cstr(APP_ID));
    case 'Title':
      return g.g_variant_new_string(cstr(state.title));
    case 'Status':
      return g.g_variant_new_string(cstr('Active'));
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

/** Build + register the live SNI object; returns a `TrayInstance`, or null on any failure. */
const createLive = (conn: Pointer, initialImage: string): TrayInstance | null => {
  const gdbus = loadGDBusFFI();
  const node = nodeInfoNewForXml(SNI_XML);
  if (node === null) {
    return null; // malformed XML — never crash (guard the NULL deref).
  }
  const iface = nodeInfoLookupInterface(node, SNI_IFACE);
  if (iface === null) {
    return null;
  }

  const state: State = {
    title: 'Bunmaska',
    toolTip: '',
    icon: decodeIcon(initialImage),
    click: null,
  };

  // The three vtable handlers — each wrapped so a JS throw can't cross the FFI boundary and
  // kill the pump. Retained FOREVER (the copied vtable holds their raw fn-pointers).
  const getProp = new JSCallback((_c, _s, _p, _i, propName, _e, _u): Pointer | null => {
    try {
      return getPropertyValue(state, propName === null ? '' : new CString(propName).toString());
    } catch {
      // A failed getter returns null → GDBus synthesizes an error for that one property.
      return null;
    }
  }, DBUS_GET_PROPERTY_CB_DEF);

  const methodCall = new JSCallback((_c, _s, _p, _i, method, _params, invocation, _u): void => {
    try {
      if ((method === null ? '' : new CString(method).toString()) === 'Activate') {
        state.click?.();
      }
    } catch {
      // A faulty click handler must not crash the GMainContext dispatch.
    }
    // Complete every method with an empty reply so the host is never left hanging.
    gdbus.symbols.g_dbus_method_invocation_return_value(invocation, null);
  }, DBUS_METHOD_CALL_CB_DEF);

  const setProp = new JSCallback((): number => 0, DBUS_SET_PROPERTY_CB_DEF); // all read-only

  const mcPtr = methodCall.ptr;
  const gpPtr = getProp.ptr;
  const spPtr = setProp.ptr;
  if (mcPtr === null || gpPtr === null || spPtr === null) {
    return null;
  }

  const vtable = new BigUint64Array(VTABLE_SLOTS); // [method_call, get_property, set_property, 0×8]
  vtable[0] = BigInt(mcPtr);
  vtable[1] = BigInt(gpPtr);
  vtable[2] = BigInt(spPtr);

  const regId = registerObject(conn, OBJECT_PATH, iface, ptr(vtable));
  if (regId === 0) {
    return null;
  }
  retained.callbacks.push(methodCall, getProp, setProp); // load-bearing: the vtable copy points here.
  retained.misc.push(node, vtable);

  // Register with the watcher via the bounded method call. The watcher reads our sender's
  // unique name, so g_bus_own_name is unnecessary. Absent watcher ⇒ fast null ⇒ icon
  // simply doesn't appear (no hang).
  const uniqueName = getUniqueName(conn);
  const g = loadGlibFFI().symbols;
  const nameVariant = uniqueName === null ? null : g.g_variant_new_string(cstr(uniqueName));
  if (nameVariant !== null) {
    const args = g.g_variant_new_tuple(ptr(new BigUint64Array([BigInt(nameVariant)])), 1n);
    callMethodSync(
      conn,
      WATCHER_NAME,
      WATCHER_PATH,
      WATCHER_NAME,
      'RegisterStatusNotifierItem',
      args,
    );
  }

  let destroyed = false;
  return {
    setToolTip: (toolTip) => {
      state.toolTip = toolTip;
      emitSignal(conn, OBJECT_PATH, SNI_IFACE, 'NewToolTip', null);
    },
    setTitle: (title) => {
      state.title = title;
      emitSignal(conn, OBJECT_PATH, SNI_IFACE, 'NewTitle', null);
    },
    setImage: (image) => {
      state.icon = decodeIcon(image); // old argb stays retained (an in-flight reply may use it).
      emitSignal(conn, OBJECT_PATH, SNI_IFACE, 'NewIcon', null); // argument-less; host re-fetches.
    },
    setContextMenu: () => undefined, // deferred: dbusmenu is a follow-up (soft no-op, never throws).
    onClick: (callback) => {
      state.click = callback;
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      unregisterObject(conn, regId); // do NOT close the callbacks (retained forever).
    },
    isDestroyed: () => destroyed,
  };
};

/** The Linux tray backend (StatusNotifierItem over D-Bus). */
export const linuxTrayBackend: TrayBackend = {
  create: (image) => {
    if (!liveTrayEnabled()) {
      return inertInstance();
    }
    const conn = probeSessionBusUnchecked();
    if (conn === null) {
      return inertInstance();
    }
    return createLive(conn, image) ?? inertInstance();
  },
};
