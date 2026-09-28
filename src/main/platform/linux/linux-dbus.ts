import { CString, JSCallback, type Pointer } from 'bun:ffi';
import { reportCallbackError } from '../../../common/report-error';
import { cstr } from '../cstr';
import {
  DBUS_CALL_TIMEOUT_MS,
  DBUS_SIGNAL_CB_DEF,
  G_BUS_TYPE_SESSION,
  G_BUS_TYPE_SYSTEM,
  G_DBUS_CALL_FLAGS_NONE,
  G_DBUS_SIGNAL_FLAGS_NONE,
  loadGDBusFFI,
} from './gdbus-ffi';

/**
 * GDBus primitives (D037, D038). Never block the pumped thread on a reply only our GMainContext
 * can deliver (the D033 hang): signals dispatch during pump iterations, and callMethodSync's
 * bounded call_sync is answered on GDBus's worker thread. THREAD INVARIANT: subscribe on the
 * pumped main thread with no thread-default context pushed, or signals dispatch to a context
 * the pump never iterates and silently never fire.
 */

/** An omitted field matches anything. */
export type SignalMatch = {
  readonly sender?: string;
  readonly interface?: string;
  readonly member?: string;
  readonly path?: string;
  readonly arg0?: string;
};

export type SignalEvent = {
  readonly signalName: string;
  /** BORROWED tuple: read it synchronously, never unref it. */
  readonly parameters: Pointer;
};

/** Unset in CI, so no system bus is touched there. */
const liveSystemBusEnabled = (): boolean => process.env['BUNMASKA_ENABLE_LINUX_POWER'] === '1';

/** `undefined` until probed; `null` when absent or disabled. */
const cache: { systemBus: Pointer | null | undefined } = { systemBus: undefined };

/** Subscriptions are permanent, so their callbacks are retained forever and never closed. */
const retainedSubscriptionCallbacks: JSCallback[] = [];

/** Bypasses the env gate so a test can prove the probe returns fast; null without a bus. */
export const probeSystemBusUnchecked = (): Pointer | null => {
  const gdbus = loadGDBusFFI();
  try {
    // NULL GError**: a NULL return already means no bus.
    return gdbus.symbols.g_bus_get_sync(G_BUS_TYPE_SYSTEM, null, null);
  } catch {
    return null;
  }
};

/**
 * Null when BUNMASKA_ENABLE_LINUX_POWER is off or there is no bus. g_bus_get_sync blocks on
 * socket I/O but never needs the pump; the result, null included, is cached so it runs once.
 */
export const getSystemBus = (): Pointer | null => {
  if (cache.systemBus !== undefined) {
    return cache.systemBus;
  }
  const conn = liveSystemBusEnabled() ? probeSystemBusUnchecked() : null;
  cache.systemBus = conn;
  return conn;
};

/** Permanent; returns the subscription id. A throwing `cb` is swallowed. */
export const subscribeSignal = (
  conn: Pointer,
  match: SignalMatch,
  cb: (event: SignalEvent) => void,
): number => {
  const gdbus = loadGDBusFFI();
  const callback = new JSCallback(
    (
      _connection: Pointer,
      _senderName: Pointer,
      _objectPath: Pointer,
      _interfaceName: Pointer,
      signalName: Pointer,
      parameters: Pointer,
      _userData: Pointer,
    ): void => {
      try {
        cb({
          signalName: signalName === null ? '' : new CString(signalName).toString(),
          parameters,
        });
      } catch (error) {
        // A throw must not unwind into the GMainContext dispatch.
        reportCallbackError(error);
      }
    },
    DBUS_SIGNAL_CB_DEF,
  );
  const cbPtr = callback.ptr;
  if (cbPtr === null) {
    throw new Error('Failed to allocate a GDBusSignalCallback thunk');
  }
  retainedSubscriptionCallbacks.push(callback);
  return gdbus.symbols.g_dbus_connection_signal_subscribe(
    conn,
    match.sender === undefined ? null : cstr(match.sender),
    match.interface === undefined ? null : cstr(match.interface),
    match.member === undefined ? null : cstr(match.member),
    match.path === undefined ? null : cstr(match.path),
    match.arg0 === undefined ? null : cstr(match.arg0),
    G_DBUS_SIGNAL_FLAGS_NONE,
    cbPtr,
    null,
    null,
  );
};

/** Test-only. */
export const resetSystemBusCacheForTesting = (): void => {
  cache.systemBus = undefined;
};

/** Separate from the system-bus flag: outbound calls on another bus. Unset in CI. */
const liveBlockerEnabled = (): boolean =>
  process.env['BUNMASKA_ENABLE_LINUX_POWER_BLOCKER'] === '1';

const sessionCache: { sessionBus: Pointer | null | undefined } = { sessionBus: undefined };

/** Bypasses the env gate; null without a bus. */
export const probeSessionBusUnchecked = (): Pointer | null => {
  const gdbus = loadGDBusFFI();
  try {
    return gdbus.symbols.g_bus_get_sync(G_BUS_TYPE_SESSION, null, null);
  } catch {
    return null;
  }
};

/** Null when BUNMASKA_ENABLE_LINUX_POWER_BLOCKER is off or there is no bus. Cached. */
export const getSessionBus = (): Pointer | null => {
  if (sessionCache.sessionBus !== undefined) {
    return sessionCache.sessionBus;
  }
  const conn = liveBlockerEnabled() ? probeSessionBusUnchecked() : null;
  sessionCache.sessionBus = conn;
  return conn;
};

/**
 * Blocks for at most DBUS_CALL_TIMEOUT_MS. `parameters` (floating, or null) is CONSUMED; the
 * reply is transfer-full (the caller unrefs it), or null on any failure.
 */
export const callMethodSync = (
  conn: Pointer,
  busName: string,
  objectPath: string,
  iface: string,
  method: string,
  parameters: Pointer | null,
): Pointer | null => {
  const gdbus = loadGDBusFFI();
  try {
    return gdbus.symbols.g_dbus_connection_call_sync(
      conn,
      cstr(busName),
      cstr(objectPath),
      cstr(iface),
      cstr(method),
      parameters,
      null, // reply_type
      G_DBUS_CALL_FLAGS_NONE,
      DBUS_CALL_TIMEOUT_MS,
      null, // cancellable
      null, // error: a NULL return already means failure
    );
  } catch {
    return null;
  }
};

/** Test-only. */
export const resetSessionBusCacheForTesting = (): void => {
  sessionCache.sessionBus = undefined;
};

/** Transfer-full; keep it alive for as long as an object is registered with it. */
export const nodeInfoNewForXml = (xml: string): Pointer | null =>
  loadGDBusFFI().symbols.g_dbus_node_info_new_for_xml(cstr(xml), null);

/** BORROWED from `node`. */
export const nodeInfoLookupInterface = (node: Pointer, name: string): Pointer | null =>
  loadGDBusFFI().symbols.g_dbus_node_info_lookup_interface(node, cstr(name));

/**
 * Returns the registration id (0 on failure). GDBus copies the vtable, but the copy holds the
 * JSCallbacks' raw function pointers: the caller must retain those callbacks forever.
 */
export const registerObject = (
  conn: Pointer,
  objectPath: string,
  interfaceInfo: Pointer,
  vtablePtr: Pointer,
): number =>
  loadGDBusFFI().symbols.g_dbus_connection_register_object(
    conn,
    cstr(objectPath),
    interfaceInfo,
    vtablePtr,
    null,
    null,
    null,
  );

export const unregisterObject = (conn: Pointer, registrationId: number): void => {
  loadGDBusFFI().symbols.g_dbus_connection_unregister_object(conn, registrationId);
};

/** Broadcast. `parameters` (floating, or null for no arguments) is CONSUMED. */
export const emitSignal = (
  conn: Pointer,
  objectPath: string,
  iface: string,
  signalName: string,
  parameters: Pointer | null,
): void => {
  loadGDBusFFI().symbols.g_dbus_connection_emit_signal(
    conn,
    null, // no destination
    cstr(objectPath),
    cstr(iface),
    cstr(signalName),
    parameters,
    null,
  );
};
