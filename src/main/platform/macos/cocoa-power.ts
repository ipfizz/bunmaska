import {
  distributedNotificationCenter,
  observeNotification,
  workspaceNotificationCenter,
} from './cocoa-notification-observer';
import { idleStateFrom } from '../idle-state';
import type { PowerEventHandlers, PowerMonitorBackend, SystemIdleState } from '../services';
import { loadCoreGraphicsFFI } from './cocoa-screen';
import { macosIsOnBatteryPower } from './iokit-power-ffi';

const WILL_SLEEP = 'NSWorkspaceWillSleepNotification';
const DID_WAKE = 'NSWorkspaceDidWakeNotification';
const SCREEN_LOCKED = 'com.apple.screenIsLocked';
const SCREEN_UNLOCKED = 'com.apple.screenIsUnlocked';
const K_CG_EVENT_SOURCE_STATE_COMBINED_SESSION = 0;
/** `kCGAnyInputEventType` (~0u). */
const K_CG_ANY_INPUT_EVENT_TYPE = 0xffffffff;

let locked = false;
let lastOnBattery: boolean | undefined;

/** Register the four power/lock observers. Retained for the process lifetime. */
export const observePowerEvents = (handlers: PowerEventHandlers): void => {
  const workspace = workspaceNotificationCenter();
  observeNotification(workspace, WILL_SLEEP, handlers.onSuspend);
  observeNotification(workspace, DID_WAKE, () => {
    handlers.onResume();
    emitPowerSource(handlers);
  });
  const distributed = distributedNotificationCenter();
  observeNotification(distributed, SCREEN_LOCKED, () => {
    locked = true;
    handlers.onLockScreen();
  });
  observeNotification(distributed, SCREEN_UNLOCKED, () => {
    locked = false;
    handlers.onUnlockScreen();
  });
  emitPowerSource(handlers);
  const timer = setInterval(() => emitPowerSource(handlers), 2_000);
  timer.unref();
};

const emitPowerSource = (handlers: PowerEventHandlers): void => {
  const onBattery = macosIsOnBatteryPower();
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

export const macosGetSystemIdleTime = (): number => {
  const seconds = loadCoreGraphicsFFI().symbols.CGEventSourceSecondsSinceLastEventType(
    K_CG_EVENT_SOURCE_STATE_COMBINED_SESSION,
    K_CG_ANY_INPUT_EVENT_TYPE,
  );
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
};

export const macosGetSystemIdleState = (idleThreshold: number): SystemIdleState =>
  idleStateFrom(macosGetSystemIdleTime(), idleThreshold, locked);

export const macosPowerMonitorBackend: PowerMonitorBackend = {
  observe: observePowerEvents,
  getSystemIdleTime: macosGetSystemIdleTime,
  getSystemIdleState: macosGetSystemIdleState,
  isOnBatteryPower: macosIsOnBatteryPower,
};
