import { ptr } from 'bun:ffi';
import type {
  NotificationBackend,
  NotificationHandle,
  NotificationSpec,
} from '../../api/notification';
import { wstr } from './win32';
import { loadUser32 } from './win32-ffi';
import { loadShell32 } from './win32-shell-ffi';
import { createMessageWindow } from './windows-message-window';

/**
 * Windows desktop notifications, the WinCairo peer of the libnotify (Linux) and
 * `NSUserNotification` (macOS) backends. A notification is shown as a tray-icon
 * balloon (`Shell_NotifyIcon` with `NIF_INFO`), which Windows 10/11 surfaces as a
 * real toast in the Action Center — a FLAT-C path with NO COM (the modern WinRT
 * toast API is heavily COM-bound; this honours the minimal-COM policy).
 *
 * v1 covers title + body + the silent flag, and `close` (when the balloon is
 * dismissed) via the icon's callback message; rich toasts (buttons, images,
 * inline replies) and a registered AppUserModelID are a follow-up — the app
 * identity shown is the executable's.
 */

/** Custom callback message the notification icon posts (WM_APP range). */
export const WM_NOTIFICATION = 0x8000 + 2;

const NIM_ADD = 0;
const NIM_DELETE = 2;
const NIF_MESSAGE = 0x1;
const NIF_ICON = 0x2;
const NIF_INFO = 0x10;
const NIIF_INFO = 0x1;
const NIIF_NOSOUND = 0x10;
const IDI_APPLICATION = 32512n;

/** Balloon-dismissal notification codes (in the low word of the callback `lParam`). */
const NIN_BALLOONHIDE = 0x0403;
const NIN_BALLOONTIMEOUT = 0x0404;
const NIN_BALLOONUSERCLICK = 0x0405;

// NOTIFYICONDATAW (x64) size + the field offsets used here.
const NID_SIZE = 976;
const NID_HWND_OFFSET = 8;
const NID_UID_OFFSET = 16;
const NID_FLAGS_OFFSET = 20;
const NID_CALLBACK_OFFSET = 24;
const NID_HICON_OFFSET = 32;
const NID_INFO_OFFSET = 304; // szInfo[256]
const NID_INFO_TITLE_OFFSET = 820; // szInfoTitle[64]
const NID_INFO_FLAGS_OFFSET = 948; // dwInfoFlags
const NID_INFO_MAX_BYTES = 510; // 255 WCHARs
const NID_INFO_TITLE_MAX_BYTES = 126; // 63 WCHARs

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

/** Copy a JS string into a NOTIFYICONDATAW wide-char field, capped to its byte width. */
const setWideField = (nid: Uint8Array, offset: number, value: string, maxBytes: number): void => {
  const bytes = wstr(value);
  nid.set(bytes.subarray(0, Math.min(bytes.length, maxBytes)), offset);
};

/** Build the NOTIFYICONDATAW for a notification balloon (also valid for NIM_DELETE). */
const buildNotifyData = (
  hwnd: bigint,
  uid: number,
  hIcon: bigint,
  spec: NotificationSpec,
): Uint8Array => {
  const nid = new Uint8Array(NID_SIZE);
  const view = new DataView(nid.buffer);
  view.setUint32(0, NID_SIZE, true);
  view.setBigUint64(NID_HWND_OFFSET, hwnd, true);
  view.setUint32(NID_UID_OFFSET, uid, true);
  view.setUint32(NID_FLAGS_OFFSET, NIF_MESSAGE | NIF_ICON | NIF_INFO, true);
  view.setUint32(NID_CALLBACK_OFFSET, WM_NOTIFICATION, true);
  view.setBigUint64(NID_HICON_OFFSET, hIcon, true);
  // The subtitle (where present) prefixes the body as a first line.
  const body = spec.subtitle.length > 0 ? `${spec.subtitle}\n${spec.body}` : spec.body;
  setWideField(nid, NID_INFO_OFFSET, body, NID_INFO_MAX_BYTES);
  setWideField(nid, NID_INFO_TITLE_OFFSET, spec.title, NID_INFO_TITLE_MAX_BYTES);
  view.setUint32(NID_INFO_FLAGS_OFFSET, notificationInfoFlags(spec.silent), true);
  return nid;
};

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
