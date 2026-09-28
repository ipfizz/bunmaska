import type { Pointer } from 'bun:ffi';
import type { PowerEventHandlers } from '../services';
import { loadGlibFFI } from './glib-ffi';
import { getSystemBus, type SignalEvent, type SignalMatch, subscribeSignal } from './linux-dbus';

// logind on the system bus (D037). Lock/Unlock are a Bunmaska extension (Electron has none on Linux) and
// match any session path, so they can over-fire on multi-seat systems.
// ponytail: no delay inhibitor, so 'suspend' can land after wake; hold logind Inhibit('sleep', 'delay').

const LOGIN1_NAME = 'org.freedesktop.login1';
const MANAGER_IFACE = 'org.freedesktop.login1.Manager';
const SESSION_IFACE = 'org.freedesktop.login1.Session';
const MANAGER_PATH = '/org/freedesktop/login1';
const PREPARE_FOR_SLEEP = 'PrepareForSleep';
const LOCK = 'Lock';
const UNLOCK = 'Unlock';

export const decodePrepareForSleep = (start: boolean, handlers: PowerEventHandlers): void => {
  if (start) {
    handlers.onSuspend();
  } else {
    handlers.onResume();
  }
};

/**
 * `g_variant_get_child_value` (bad index) and `g_variant_get_boolean` (non-`b`) ABORT, which no
 * try/catch can stop: check the count and type first. The tuple is borrowed; the child is transfer-full.
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

export type PowerDbusDeps = {
  getSystemBus: () => Pointer | null;
  subscribeSignal: (conn: Pointer, match: SignalMatch, cb: (e: SignalEvent) => void) => number;
  readSleepBoolean: (parameters: Pointer) => boolean;
};

const realDeps: PowerDbusDeps = { getSystemBus, subscribeSignal, readSleepBoolean };

/** A no-op without a system bus; subscriptions last the process lifetime. */
export const observePowerEvents = (
  handlers: PowerEventHandlers,
  deps: PowerDbusDeps = realDeps,
): void => {
  const bus = deps.getSystemBus();
  if (bus === null) {
    return;
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
  deps.subscribeSignal(bus, { sender: LOGIN1_NAME, interface: SESSION_IFACE, member: LOCK }, () =>
    handlers.onLockScreen(),
  );
  deps.subscribeSignal(bus, { sender: LOGIN1_NAME, interface: SESSION_IFACE, member: UNLOCK }, () =>
    handlers.onUnlockScreen(),
  );
};
