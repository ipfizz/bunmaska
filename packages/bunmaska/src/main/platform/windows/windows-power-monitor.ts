import type { PowerEventHandlers } from '../macos/cocoa-power';
import { loadWtsapi32, NOTIFY_FOR_THIS_SESSION } from './win32-wts-ffi';
import { createMessageWindow, type MessageWindow } from './windows-message-window';

/**
 * Windows `powerMonitor` events, the WinCairo peer of the NSWorkspace (macOS) and
 * logind (Linux) backends. Suspend/resume arrive as `WM_POWERBROADCAST` (broadcast
 * to top-level windows); lock/unlock as `WM_WTSSESSION_CHANGE` after
 * `WTSRegisterSessionNotification`. Both are delivered to a hidden, non-WebKit
 * window (see `windows-message-window.ts`) and translated to the handlers here.
 * The message → handler mapping is a pure function so it unit-tests with no window.
 */

/** `WM_POWERBROADCAST` — system power-state change. */
export const WM_POWERBROADCAST = 0x0218;
/** `WM_WTSSESSION_CHANGE` — a session lock/unlock/connect/disconnect. */
export const WM_WTSSESSION_CHANGE = 0x02b1;

/** `WM_POWERBROADCAST` events: the system is suspending / has resumed. */
const PBT_APMSUSPEND = 0x0004;
const PBT_APMRESUMESUSPEND = 0x0007;
const PBT_APMRESUMEAUTOMATIC = 0x0012;

/** `WM_WTSSESSION_CHANGE` events: the session was locked / unlocked. */
const WTS_SESSION_LOCK = 0x7;
const WTS_SESSION_UNLOCK = 0x8;

/**
 * Translate a power/session window message to the matching `powerMonitor` handler.
 * Pure: `wParam` carries the specific event code. Unrelated messages are ignored.
 */
export const dispatchPowerMessage = (
  handlers: PowerEventHandlers,
  message: number,
  wParam: number,
): void => {
  if (message === WM_POWERBROADCAST) {
    if (wParam === PBT_APMSUSPEND) {
      handlers.onSuspend();
    } else if (wParam === PBT_APMRESUMESUSPEND || wParam === PBT_APMRESUMEAUTOMATIC) {
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

/** The hidden window the power observer owns (process life; never torn down). */
let observerWindow: MessageWindow | undefined;

/**
 * Begin delivering power + lock/unlock events to `handlers`. Creates the hidden
 * notification window (once), registers for session notifications (best-effort —
 * a failure only loses lock/unlock, never suspend/resume), and routes messages.
 */
export const observePowerEvents = (handlers: PowerEventHandlers): void => {
  if (observerWindow !== undefined) {
    return;
  }
  observerWindow = createMessageWindow((message, wParam) =>
    dispatchPowerMessage(handlers, message, Number(wParam)),
  );
  try {
    loadWtsapi32().symbols.WTSRegisterSessionNotification(
      observerWindow.hwnd,
      NOTIFY_FOR_THIS_SESSION,
    );
  } catch {
    // Lock/unlock notifications are unavailable; suspend/resume still work.
  }
};
