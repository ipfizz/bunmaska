import { ptr } from 'bun:ffi';
import type {
  NotificationBackend,
  NotificationHandle,
  NotificationSpec,
} from '../../api/notification';
import { loadUser32 } from './win32-ffi';
import { loadShell32, NIM_ADD, NIM_DELETE, notifyIconData } from './win32-shell-ffi';
import { createMessageWindow } from './windows-message-window';

/**
 * A notification is shown as a tray-icon balloon (`Shell_NotifyIcon` with `NIF_INFO`),
 * which Windows 10/11 surfaces as a real toast in the Action Center — a FLAT-C path with
 * NO COM (the modern WinRT toast API is heavily COM-bound; this honours the minimal-COM
 * policy). Rich toasts and a registered AppUserModelID are a follow-up.
 */

/** Custom callback message the notification icon posts (WM_APP range). */
export const WM_NOTIFICATION = 0x8000 + 2;

const NIIF_INFO = 0x1;
const NIIF_NOSOUND = 0x10;
const IDI_APPLICATION = 32512n;

/** Balloon-dismissal notification codes (in the low word of the callback `lParam`). */
const NIN_BALLOONHIDE = 0x0403;
const NIN_BALLOONTIMEOUT = 0x0404;
const NIN_BALLOONUSERCLICK = 0x0405;

let nextUid = 1;

/** The `dwInfoFlags` for a notification balloon (info icon; muted when silent). Pure. */
export const notificationInfoFlags = (silent: boolean): number =>
  NIIF_INFO | (silent ? NIIF_NOSOUND : 0);

/** Whether a callback message is this notification's balloon dismissal. Pure. */
export const isBalloonDismiss = (
  message: number,
  wParam: number,
  lParam: number,
  uid: number,
): boolean => {
  if (message !== WM_NOTIFICATION || wParam !== uid) {
    return false;
  }
  const code = lParam & 0xffff;
  return code === NIN_BALLOONHIDE || code === NIN_BALLOONTIMEOUT || code === NIN_BALLOONUSERCLICK;
};

/** The balloon `NOTIFYICONDATAW` for `spec` (also valid for NIM_DELETE). */
const buildNotifyData = (
  hwnd: bigint,
  uid: number,
  hIcon: bigint,
  spec: NotificationSpec,
): Uint8Array =>
  notifyIconData({
    hwnd,
    uid,
    callbackMessage: WM_NOTIFICATION,
    hIcon,
    info: {
      // The subtitle (where present) prefixes the body as a first line.
      text: spec.subtitle.length > 0 ? `${spec.subtitle}\n${spec.body}` : spec.body,
      title: spec.title,
      flags: notificationInfoFlags(spec.silent),
    },
  });

export const windowsNotificationBackend: NotificationBackend = {
  // The balloon mechanism is always available on Windows.
  isSupported: (): boolean => true,

  present(spec: NotificationSpec): NotificationHandle {
    const uid = nextUid++;
    const shell32 = loadShell32().symbols;
    const hIcon = loadUser32().symbols.LoadIconW(0n, IDI_APPLICATION);
    let closedCallback: (() => void) | undefined;
    let dismissed = false;

    // The handler closes over `window` (assigned synchronously just below; the
    // balloon dismissal that triggers it only ever arrives later via the pump).
    const window = createMessageWindow((message, wParam, lParam) => {
      if (dismissed || !isBalloonDismiss(message, Number(wParam), Number(lParam), uid)) {
        return;
      }
      dismissed = true;
      shell32.Shell_NotifyIconW(NIM_DELETE, ptr(buildNotifyData(window.hwnd, uid, hIcon, spec)));
      window.destroy();
      closedCallback?.();
    });

    shell32.Shell_NotifyIconW(NIM_ADD, ptr(buildNotifyData(window.hwnd, uid, hIcon, spec)));

    return {
      close(): void {
        if (dismissed) {
          return;
        }
        dismissed = true;
        shell32.Shell_NotifyIconW(NIM_DELETE, ptr(buildNotifyData(window.hwnd, uid, hIcon, spec)));
        window.destroy();
        closedCallback?.();
      },
      onClosed(callback: () => void): void {
        closedCallback = callback;
      },
    };
  },
};
