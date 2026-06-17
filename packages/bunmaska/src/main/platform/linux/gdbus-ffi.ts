import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * GDBus (D-Bus over GIO) symbols behind Bunmaska's deadlock-safe signal-subscription
 * primitive (from `libgio-2.0.so.0`, a hard dependency of GTK 4).
 *
 * SCOPE IS DELIBERATELY MINIMAL — only `g_bus_get_sync` + signal subscribe/unsubscribe.
 * `g_dbus_connection_call_sync` is INTENTIONALLY ABSENT: it parks the calling thread on
 * a reply that only the GMainContext dispatch can deliver, so on Bunmaska's single pumped
 * thread it would DEADLOCK (the same class of hang the synchronous GIO clipboard read
 * caused — see gtk-clipboard.ts). Signal SUBSCRIPTION is safe: the registered
 * `GDBusSignalCallback` fires on the GMainContext during ordinary cooperative-pump
 * iterations (gtk-run-loop.ts), so no thread ever blocks for it.
 *
 * `g_bus_get_sync` IS permitted: its wire handshake runs on GIO's PRIVATE worker context
 * (not Bunmaska's pump), and it FAILS FAST with NULL when no bus is reachable — it never
 * needs our pump to turn, so it cannot deadlock. We pass NULL for the `GError**`; a NULL
 * return already means "no/failed bus" (the libsecret-keyring.ts discipline).
 *
 * Convention (matches the existing Linux loaders): `gboolean` is {@link FFIType.i32};
 * `guint`/`GQuark` are {@link FFIType.u32}; `GBusType`/`GDBusSignalFlags` are
 * {@link FFIType.i32}/{@link FFIType.u32}; every handle, `GCancellable*`, `GError**`,
 * `GDBusSignalCallback`, and `GDestroyNotify` is a real pointer ({@link FFIType.pointer}),
 * with NULL passed for the unused ones; `cstring` args are NUL-terminated UTF-8 (or NULL
 * to match any value, e.g. a NULL `sender`/`arg0`).
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so the module
 * stays safely importable on macOS for unit testing.
 */

const LIBGIO_PATH = 'libgio-2.0.so.0';

/** `GBusType` enum (gio/gioenums.h): STARTER=-1, NONE=0, SYSTEM=1, SESSION=2. */
export const G_BUS_TYPE_SYSTEM = 1;
export const G_BUS_TYPE_SESSION = 2;
/** `GDBusSignalFlags` — no special matching. */
export const G_DBUS_SIGNAL_FLAGS_NONE = 0;
/** `GDBusCallFlags` — default. */
export const G_DBUS_CALL_FLAGS_NONE = 0;
/** Bounded reply timeout (ms). NEVER `G_MAXINT` — a finite backstop against a peer that never answers. */
export const DBUS_CALL_TIMEOUT_MS = 5000;

/**
 * ABI shape of `GDBusSignalCallback`:
 * `(connection, sender_name, object_path, interface_name, signal_name, parameters, user_data) -> void`.
 * A `*_CB_DEF` constant (Bun hides a JSCallback's def at runtime) so the ABI is unit-testable.
 */
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

/** The GDBus FFI symbol descriptor table (from `libgio-2.0.so.0`). */
export const GDBUS_FFI_SYMBOLS = {
  // (bus_type:GBusType, cancellable:GCancellable*|null, error:GError**|null) -> GDBusConnection*
  //  (shared singleton; NULL on failure). Fails FAST (socket connect) when no bus is present.
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
  // (connection, subscription_id:guint) -> void.
  g_dbus_connection_signal_unsubscribe: {
    args: [FFIType.pointer, FFIType.u32],
    returns: FFIType.void,
  },
  // Bounded REMOTE method call. SAFE on the pumped thread: the reply is read by the
  // connection's PRIVATE GDBusWorker thread and call_sync awaits it on its OWN private
  // GMainContext (gdbusconnection.c), so it blocks only THIS thread for a bounded round
  // trip and never needs Bunmaska's pump to turn (unlike the clipboard local-pipe read). A
  // FINITE timeout_msec (NEVER G_MAXINT) is mandatory. The floating `parameters` GVariant
  // is consumed by the call; the reply tuple is transfer-full (caller g_variant_unref).
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
  // --- Object export (StatusNotifierItem service) ---
  // (xml:cstring, error:GError**|null) -> GDBusNodeInfo* (transfer-full; keep alive forever).
  g_dbus_node_info_new_for_xml: {
    args: [FFIType.cstring, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (node:GDBusNodeInfo*, name:cstring) -> GDBusInterfaceInfo* (BORROWED — owned by the node).
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

const cache: { ffi: ReturnType<typeof dlopen<typeof GDBUS_FFI_SYMBOLS>> | undefined } = {
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

/** Open `libgio-2.0.so.0` and expose the GDBus connection + signal symbols. */
export const loadGDBusFFI = () => {
  requireLinux();
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBGIO_PATH, GDBUS_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
