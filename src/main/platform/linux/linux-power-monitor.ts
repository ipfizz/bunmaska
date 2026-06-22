import type { Pointer } from 'bun:ffi';
import type { PowerEventHandlers } from '../macos/cocoa-power';
import { loadGlibFFI } from './glib-ffi';
import { getSystemBus, type SignalEvent, type SignalMatch, subscribeSignal } from './linux-dbus';

/**
 * Linux power + screen-lock events for `powerMonitor` — the GDBus/logind equivalent of
 * the macOS cocoa-power module. Emits the SAME four events, so it drops into the existing
 * `PowerEventHandlers` seam unchanged.
 *
 * Source: systemd-logind on the SYSTEM bus (well-known name org.freedesktop.login1):
 *  - Manager :: `PrepareForSleep(b start)` at /org/freedesktop/login1
 *    → start=true  ⇒ about to suspend ⇒ onSuspend()
 *    → start=false ⇒ resumed          ⇒ onResume()
 *  - Session :: `Lock()` / `Unlock()` (no args, any session path) → onLockScreen()/onUnlockScreen()
 *
 * DEADLOCK-SAFE: no `*_call_sync`. We never resolve the active session's object path
 * (which would need a blocking method call); we subscribe with a NULL object path so any
 * session's Lock/Unlock matches. Signals fire on the GMainContext via the cooperative pump.
 *
 * KNOWN COARSENESS (matches Electron's Linux limits): the NULL-path Lock/Unlock match can
 * over-fire on multi-seat / fast-user-switching systems (another session's lock fires
 * ours), and logind only emits Lock/Unlock when something drives the session's `Lock`/
 * `Unlock` D-Bus methods (e.g. `loginctl lock-session`) — a bare `i3lock`/`xscreensaver`
 * that does not integrate with logind won't fire `lock-screen`. These are logind limits,
 * not bugs.
 *
 * NO-BUS-SAFE: when there is no system bus / the gate is off (headless CI), {@link getSystemBus}
 * returns null and this is a clean no-op — no subscription, no events, no throw, no hang.
 * Lazy: zero FFI at import; everything runs inside `observePowerEvents`, called at onReady.
 */

const LOGIN1_NAME = 'org.freedesktop.login1';
const MANAGER_IFACE = 'org.freedesktop.login1.Manager';
const SESSION_IFACE = 'org.freedesktop.login1.Session';
const MANAGER_PATH = '/org/freedesktop/login1';
const PREPARE_FOR_SLEEP = 'PrepareForSleep';
const LOCK = 'Lock';
const UNLOCK = 'Unlock';

/**
 * Map a decoded `PrepareForSleep` boolean to the right handler. PURE (no FFI): true ⇒
 * suspend (about to sleep), false ⇒ resume (woke up).
 */
export const decodePrepareForSleep = (start: boolean, handlers: PowerEventHandlers): void => {
  if (start) {
    handlers.onSuspend();
  } else {
    handlers.onResume();
  }
};

/**
 * Read the `b` out of a `PrepareForSleep` `(b)` parameters tuple (the BORROWED tuple is
 * never unref'd; the child from `g_variant_get_child_value` is transfer-full → unref'd).
 *
 * GUARDED against a malformed/forward-incompatible frame: both `g_variant_get_child_value`
 * (out-of-range index) and `g_variant_get_boolean` (non-boolean) ABORT the process, and a
 * native abort is NOT catchable by the `try/catch` in `subscribeSignal` — so we check the
 * child count and the child's type string first and bail (return false) on a mismatch.
 */
const readSleepBoolean = (parameters: Pointer): boolean => {
  const glib = loadGlibFFI();
  if (glib.symbols.g_variant_n_children(parameters) < 1n) {
    return false;
  }
  const child = glib.symbols.g_variant_get_child_value(parameters, 0n);
  if (child === null) {
    return false;
  }
  try {
    if (glib.symbols.g_variant_get_type_string(child)?.toString() !== 'b') {
      return false;
    }
    return glib.symbols.g_variant_get_boolean(child) !== 0;
  } finally {
    glib.symbols.g_variant_unref(child);
  }
};

/** The native operations the observer needs — injectable so the routing is unit-testable without FFI. */
export type PowerDbusDeps = {
  getSystemBus: () => Pointer | null;
  subscribeSignal: (conn: Pointer, match: SignalMatch, cb: (e: SignalEvent) => void) => number;
  /** Decode a `PrepareForSleep` signal's `parameters` tuple to its boolean. */
  readSleepBoolean: (parameters: Pointer) => boolean;
};

const realDeps: PowerDbusDeps = { getSystemBus, subscribeSignal, readSleepBoolean };

/**
 * Subscribe to logind's sleep + lock signals on the system bus. A clean no-op when no
 * system bus is present. Subscriptions are permanent (process lifetime) — no teardown.
 */
export const observePowerEvents = (
  handlers: PowerEventHandlers,
  deps: PowerDbusDeps = realDeps,
): void => {
  const bus = deps.getSystemBus();
  if (bus === null) {
    return; // no logind / no system bus (e.g. headless CI) → no events, no throw, no hang.
  }
  deps.subscribeSignal(
    bus,
    {
      sender: LOGIN1_NAME,
      interface: MANAGER_IFACE,
      member: PREPARE_FOR_SLEEP,
      path: MANAGER_PATH,
    },
    (event) => decodePrepareForSleep(deps.readSleepBoolean(event.parameters), handlers),
  );
  // Lock/Unlock carry no args and arrive on a per-session object path; match any path.
  deps.subscribeSignal(bus, { sender: LOGIN1_NAME, interface: SESSION_IFACE, member: LOCK }, () =>
    handlers.onLockScreen(),
  );
  deps.subscribeSignal(bus, { sender: LOGIN1_NAME, interface: SESSION_IFACE, member: UNLOCK }, () =>
    handlers.onUnlockScreen(),
  );
};
