import { createLogger } from '../../../common/logger';
import type { PowerEventHandlers } from '../macos/cocoa-power';
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

const WTS_SESSION_LOCK = 0x7;
const WTS_SESSION_UNLOCK = 0x8;

/** Route a power/session message (`wParam` is the event code) to its handler. Pure. */
export const dispatchPowerMessage = (
  handlers: PowerEventHandlers,
  message: number,
  wParam: number,
): void => {
  if (message === WM_POWERBROADCAST) {
    if (wParam === PBT_APMSUSPEND) {
      handlers.onSuspend();
    } else if (wParam === PBT_APMRESUMEAUTOMATIC) {
      handlers.onResume();
    }
    return;
  }
  if (message === WM_WTSSESSION_CHANGE) {
    if (wParam === WTS_SESSION_LOCK) {
      handlers.onLockScreen();
    } else if (wParam === WTS_SESSION_UNLOCK) {
      handlers.onUnlockScreen();
    }
  }
};

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
