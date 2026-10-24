import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pointer } from 'bun:ffi';
import { idleStateFrom } from '../idle-state';
import type { PowerEventHandlers, PowerMonitorBackend, SystemIdleState } from '../services';
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
  emitBatterySource(handlers);
  const timer = setInterval(() => emitBatterySource(handlers), 2_000);
  timer.unref();
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
  deps.subscribeSignal(bus, { sender: LOGIN1_NAME, interface: SESSION_IFACE, member: LOCK }, () => {
    locked = true;
    handlers.onLockScreen();
  });
  deps.subscribeSignal(bus, { sender: LOGIN1_NAME, interface: SESSION_IFACE, member: UNLOCK }, () => {
    locked = false;
    handlers.onUnlockScreen();
  });
};

let lastOnBattery: boolean | undefined;

const emitBatterySource = (handlers: PowerEventHandlers): void => {
  const onBattery = readSysfsOnBattery();
  if (lastOnBattery === undefined) {
    lastOnBattery = onBattery;
    return;
  }
  if (onBattery === lastOnBattery) {
    return;
  }
  lastOnBattery = onBattery;
  if (onBattery) {
    handlers.onBattery?.();
  } else {
    handlers.onAc?.();
  }
};

let locked = false;

const POWER_SUPPLY_DIR = '/sys/class/power_supply';

const readTrimmed = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return undefined;
  }
};

/**
 * True when sysfs shows an AC adapter offline or a battery discharging.
 * `dir` is injectable so tests never touch the real host.
 */
export const readSysfsOnBattery = (dir: string = POWER_SUPPLY_DIR): boolean => {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  let sawAcOnline = false;
  let sawBatteryDischarging = false;
  for (const name of names) {
    const type = readTrimmed(join(dir, name, 'type'));
    if (type === 'Mains' || type === 'USB') {
      if (readTrimmed(join(dir, name, 'online')) === '1') {
        sawAcOnline = true;
      }
    } else if (type === 'Battery' && readTrimmed(join(dir, name, 'status')) === 'Discharging') {
      sawBatteryDischarging = true;
    }
  }
  return !sawAcOnline && sawBatteryDischarging;
};

export const linuxGetSystemIdleTime = (): number => 0;

export const linuxGetSystemIdleState = (idleThreshold: number): SystemIdleState =>
  idleStateFrom(linuxGetSystemIdleTime(), idleThreshold, locked);

export const linuxPowerMonitorBackend: PowerMonitorBackend = {
  observe: observePowerEvents,
  getSystemIdleTime: linuxGetSystemIdleTime,
  getSystemIdleState: linuxGetSystemIdleState,
  isOnBatteryPower: () => readSysfsOnBattery(),
};
