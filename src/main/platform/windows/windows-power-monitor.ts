import { ptr, read } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import { idleStateFrom } from '../idle-state';
import type { PowerEventHandlers, PowerMonitorBackend, SystemIdleState } from '../services';
import { loadKernel32, loadUser32 } from './win32-ffi';
import { loadWtsapi32, NOTIFY_FOR_THIS_SESSION } from './win32-wts-ffi';
import { createMessageWindow, type MessageWindow } from './windows-message-window';

// WM_POWERBROADCAST is broadcast to top-level windows only, hence the hidden message window.

const log = createLogger('windows-power-monitor');

export const WM_POWERBROADCAST = 0x0218;
export const WM_WTSSESSION_CHANGE = 0x02b1;

const PBT_APMSUSPEND = 0x0004;
// Sent on every resume; a user-initiated wake also sends PBT_APMRESUMESUSPEND after
// it, which is ignored so 'resume' fires once (as Chromium does).
const PBT_APMRESUMEAUTOMATIC = 0x0012;
const PBT_APMPOWERSTATUSCHANGE = 0x000a;

const LASTINPUTINFO_SIZE = 8;
const SYSTEM_POWER_STATUS_SIZE = 12;
const AC_LINE_OFFLINE = 0;
const AC_LINE_ONLINE = 1;

const WTS_SESSION_LOCK = 0x7;
const WTS_SESSION_UNLOCK = 0x8;

/** Route a power/session message (`wParam` is the event code) to its handler. Pure. */
export const dispatchPowerMessage = (
  handlers: PowerEventHandlers,
  message: number,
  wParam: number,
  onBattery: () => boolean = windowsIsOnBatteryPower,
): void => {
  if (message === WM_POWERBROADCAST) {
    if (wParam === PBT_APMSUSPEND) {
      handlers.onSuspend();
    } else if (wParam === PBT_APMRESUMEAUTOMATIC) {
      handlers.onResume();
    } else if (wParam === PBT_APMPOWERSTATUSCHANGE) {
      if (onBattery()) {
        handlers.onBattery?.();
      } else {
        handlers.onAc?.();
      }
    }
    return;
  }
  if (message === WM_WTSSESSION_CHANGE) {
    if (wParam === WTS_SESSION_LOCK) {
      locked = true;
      handlers.onLockScreen();
    } else if (wParam === WTS_SESSION_UNLOCK) {
      locked = false;
      handlers.onUnlockScreen();
    }
  }
};

/** Unsigned 32-bit tick delta, wrapping every ~49 days. Pure. */
export const idleSecondsFromTicks = (now: number, lastInput: number): number =>
  Math.floor(((now - lastInput) >>> 0) / 1000);

/** `ACLineStatus` 0 = battery, 1 = AC, 255 = unknown (treated as AC). Pure. */
export const isBatteryFromAcLine = (acLineStatus: number): boolean =>
  acLineStatus === AC_LINE_OFFLINE;

let locked = false;

export const windowsGetSystemIdleTime = (): number => {
  const info = new Uint8Array(LASTINPUTINFO_SIZE);
  new DataView(info.buffer).setUint32(0, LASTINPUTINFO_SIZE, true);
  const infoPtr = ptr(info);
  if (loadUser32().symbols.GetLastInputInfo(infoPtr) === 0) {
    return 0;
  }
  return idleSecondsFromTicks(loadKernel32().symbols.GetTickCount(), read.u32(infoPtr, 4));
};

export const windowsIsOnBatteryPower = (): boolean => {
  const status = new Uint8Array(SYSTEM_POWER_STATUS_SIZE);
  const statusPtr = ptr(status);
  if (loadKernel32().symbols.GetSystemPowerStatus(statusPtr) === 0) {
    return false;
  }
  return isBatteryFromAcLine(read.u8(statusPtr, 0));
};

export const windowsGetSystemIdleState = (idleThreshold: number): SystemIdleState =>
  idleStateFrom(windowsGetSystemIdleTime(), idleThreshold, locked);

/** Lives for the process; never torn down. */
let observerWindow: MessageWindow | undefined;

/** Deliver power and lock/unlock events to `handlers`; a WTS failure loses only lock/unlock. */
export const observePowerEvents = (handlers: PowerEventHandlers): void => {
  if (observerWindow !== undefined) {
    return;
  }
  observerWindow = createMessageWindow((message, wParam) =>
    dispatchPowerMessage(handlers, message, Number(wParam)),
  );
  let registered = false;
  try {
    registered =
      loadWtsapi32().symbols.WTSRegisterSessionNotification(
        observerWindow.hwnd,
        NOTIFY_FOR_THIS_SESSION,
      ) !== 0;
  } catch {
    // wtsapi32 is missing; handled as a failed registration below.
  }
  if (!registered) {
    // ponytail: no retry, so an early-logon failure loses lock/unlock until restart
    log.warn('lock-screen/unlock-screen unavailable: WTSRegisterSessionNotification failed');
  }
};

export const windowsPowerMonitorBackend: PowerMonitorBackend = {
  observe: observePowerEvents,
  getSystemIdleTime: windowsGetSystemIdleTime,
  getSystemIdleState: windowsGetSystemIdleState,
  isOnBatteryPower: windowsIsOnBatteryPower,
};
