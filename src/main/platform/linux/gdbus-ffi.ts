import { FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

/**
 * Deadlock rule (D037, D038): the pumped thread may block only on calls that never wait on the
 * default GMainContext, i.e. `g_bus_get_sync` (gated, cached) and a bounded `call_sync`.
 */

const LIBGIO_PATH = 'libgio-2.0.so.0';

/** `GBusType` enum (gio/gioenums.h): STARTER=-1, NONE=0, SYSTEM=1, SESSION=2. */
export const G_BUS_TYPE_SYSTEM = 1;
export const G_BUS_TYPE_SESSION = 2;
export const G_DBUS_SIGNAL_FLAGS_NONE = 0;
export const G_DBUS_CALL_FLAGS_NONE = 0;
/** Reply timeout (ms). Never `G_MAXINT`: an unbounded call on a bus-less runner hung CI 4h. */
export const DBUS_CALL_TIMEOUT_MS = 5000;

/** `GDBusSignalCallback`: (conn, sender, path, iface, signal, params, user_data) -> void. */
export const DBUS_SIGNAL_CB_DEF = {
  args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'],
  returns: 'void',
} as const;

/** `GDBusInterfaceMethodCallFunc`: (conn, sender, path, iface, method, params, invocation, user_data) -> void. */
export const DBUS_METHOD_CALL_CB_DEF = {
  args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'],
  returns: 'void',
} as const;

/** `GDBusInterfaceGetPropertyFunc`: (conn, sender, path, iface, property, error, user_data) -> GVariant*. */
export const DBUS_GET_PROPERTY_CB_DEF = {
  args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'],
  returns: 'ptr',
} as const;

/** `GDBusInterfaceSetPropertyFunc`: (conn, sender, path, iface, property, value, error, user_data) -> gboolean. */
export const DBUS_SET_PROPERTY_CB_DEF = {
  args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'],
  returns: 'i32',
} as const;

/** `GDBusInterfaceVTable` is `{ method_call; get_property; set_property; gpointer padding[8]; }` = 11 slots. */
export const VTABLE_SLOTS = 11;

export const GDBUS_FFI_SYMBOLS = {
  // (bus_type:GBusType, cancellable|null, error:GError**|null) -> GDBusConnection*
  //  (shared singleton; NULL fast when no bus is reachable).
  g_bus_get_sync: {
    args: [FFIType.i32, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (connection, sender|null, interface|null, member|null, object_path|null, arg0|null,
  //  flags:GDBusSignalFlags, callback:GDBusSignalCallback, user_data|null, free_func|null) -> guint id.
  g_dbus_connection_signal_subscribe: {
    args: [
      FFIType.pointer,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.u32,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.u32,
  },
  // Safe on the pumped thread only with a FINITE timeout: the reply is awaited on call_sync's own
  // GMainContext (D038). Consumes a floating `parameters`; the reply is transfer-full.
  // (connection, bus_name, object_path, interface_name, method_name, parameters:GVariant*,
  //  reply_type:GVariantType*|null, flags:GDBusCallFlags, timeout_msec:gint,
  //  cancellable|null, error:GError**|null) -> GVariant*
  g_dbus_connection_call_sync: {
    args: [
      FFIType.pointer,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.u32,
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.pointer,
  },
  // (xml:cstring, error:GError**|null) -> GDBusNodeInfo* (transfer-full; keep alive forever).
  g_dbus_node_info_new_for_xml: {
    args: [FFIType.cstring, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (node:GDBusNodeInfo*, name:cstring) -> GDBusInterfaceInfo* (BORROWED - owned by the node).
  g_dbus_node_info_lookup_interface: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.pointer,
  },
  // (conn, object_path, iface_info, vtable:GDBusInterfaceVTable*, user_data|null, free|null,
  //  error:GError**|null) -> guint reg_id (0 = failure). COPIES the vtable + refs iface_info.
  g_dbus_connection_register_object: {
    args: [
      FFIType.pointer,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.u32,
  },
  // (conn, registration_id:guint) -> gboolean.
  g_dbus_connection_unregister_object: {
    args: [FFIType.pointer, FFIType.u32],
    returns: FFIType.i32,
  },
  // (conn) -> const gchar* unique name (BORROWED; e.g. ":1.42").
  g_dbus_connection_get_unique_name: {
    args: [FFIType.pointer],
    returns: FFIType.cstring,
  },
  // (conn, destination|null, object_path, interface_name, signal_name, parameters:GVariant*|null,
  //  error:GError**|null) -> gboolean. CONSUMES a floating `parameters`.
  g_dbus_connection_emit_signal: {
    args: [
      FFIType.pointer,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.i32,
  },
  // (invocation:GDBusMethodInvocation*, parameters:GVariant*|null) -> void. Sinks a floating tuple
  //  (or NULL for no out-args); takes ownership of the invocation.
  g_dbus_method_invocation_return_value: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopenLinux<typeof GDBUS_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

const requireLinux = (): void => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGDBusFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
};

export const loadGDBusFFI = () => {
  requireLinux();
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopenLinux(LIBGIO_PATH, GDBUS_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
