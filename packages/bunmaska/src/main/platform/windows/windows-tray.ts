import { ptr } from 'bun:ffi';
import type { Menu } from '../../api/menu';
import type { TrayBackend, TrayInstance } from '../../api/tray';
import { wstr } from './win32';
import { loadUser32 } from './win32-ffi';
import { loadShell32 } from './win32-shell-ffi';
import { createMessageWindow } from './windows-message-window';

/**
 * Windows system-tray backend (pure `bun:ffi`), the WinCairo peer of the
 * `NSStatusItem` (macOS) and StatusNotifierItem (Linux) backends. `Shell_NotifyIcon`
 * adds/updates/removes the icon; the icon comes from a `.ico` path via `LoadImage`
 * (falling back to the default application icon, so a bad path never leaves a blank
 * slot). The icon's callback message is delivered to a hidden, non-WebKit window
 * (see `windows-message-window.ts`), where a left click fires `onClick`. As on
 * Linux v1, the context menu is accepted but DEFERRED (a Win32 `HMENU`/`TrackPopupMenu`
 * follow-up once the menu backend lands), and `setTitle` is a no-op (the Windows
 * tray shows no inline text).
 */

/** Custom callback message the tray icon posts to its owner window (WM_APP range). */
export const WM_TRAYICON = 0x8000 + 1;

const NIM_ADD = 0;
const NIM_MODIFY = 1;
const NIM_DELETE = 2;
const NIF_MESSAGE = 0x1;
const NIF_ICON = 0x2;
const NIF_TIP = 0x4;

const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const LR_DEFAULTSIZE = 0x0040;
const IDI_APPLICATION = 32512n;

/** A left mouse button release over the tray icon (the activation gesture). */
const WM_LBUTTONUP = 0x0202;

/** `sizeof(NOTIFYICONDATAW)` (current version, x64) — see the field offsets below. */
const NID_SIZE = 976;
const NID_HWND_OFFSET = 8;
const NID_UID_OFFSET = 16;
const NID_FLAGS_OFFSET = 20;
const NID_CALLBACK_OFFSET = 24;
const NID_HICON_OFFSET = 32;
const NID_TIP_OFFSET = 40;
const NID_TIP_MAX_BYTES = 254; // 127 WCHARs, leaving room for the NUL terminator

let nextUid = 1;

/**
 * Whether a tray window message is this icon's left-click activation. Pure — the
 * low word of `lParam` is the mouse event, `wParam` is the icon id.
 */
export const isTrayActivation = (
  message: number,
  wParam: number,
  lParam: number,
  uid: number,
): boolean => message === WM_TRAYICON && wParam === uid && (lParam & 0xffff) === WM_LBUTTONUP;

/** Load a `.ico` from `path`, falling back to the default application icon. */
const loadTrayIcon = (path: string): bigint => {
  const user32 = loadUser32().symbols;
  const nameBuf = wstr(path);
  const icon = user32.LoadImageW(
    0n,
    ptr(nameBuf),
    IMAGE_ICON,
    0,
    0,
    LR_LOADFROMFILE | LR_DEFAULTSIZE,
  );
  return icon !== 0n ? icon : user32.LoadIconW(0n, IDI_APPLICATION);
};

/** Build a NOTIFYICONDATAW for `Shell_NotifyIcon`. `hIcon`/`tip` are omitted for a delete. */
const notifyIconData = (hwnd: bigint, uid: number, hIcon: bigint, tip: string): Uint8Array => {
  const nid = new Uint8Array(NID_SIZE);
  const view = new DataView(nid.buffer);
  view.setUint32(0, NID_SIZE, true); // cbSize
  view.setBigUint64(NID_HWND_OFFSET, hwnd, true);
  view.setUint32(NID_UID_OFFSET, uid, true);
  view.setUint32(NID_FLAGS_OFFSET, NIF_MESSAGE | NIF_ICON | NIF_TIP, true);
  view.setUint32(NID_CALLBACK_OFFSET, WM_TRAYICON, true);
  view.setBigUint64(NID_HICON_OFFSET, hIcon, true);
  const tipBytes = wstr(tip);
  nid.set(tipBytes.subarray(0, Math.min(tipBytes.length, NID_TIP_MAX_BYTES)), NID_TIP_OFFSET);
  return nid;
};

const destroyIconSafely = (hIcon: bigint): void => {
  if (hIcon !== 0n) {
    loadUser32().symbols.DestroyIcon(hIcon);
  }
};

export const windowsTrayBackend: TrayBackend = {
  create(image: string): TrayInstance {
    const uid = nextUid++;
    const shell32 = loadShell32().symbols;
    let clickCallback: (() => void) | undefined;
    let hIcon = loadTrayIcon(image);
    let toolTip = '';
    let destroyed = false;

    const window = createMessageWindow((message, wParam, lParam) => {
      if (isTrayActivation(message, Number(wParam), Number(lParam), uid)) {
        clickCallback?.();
      }
    });

    const sync = (operation: number): void => {
      shell32.Shell_NotifyIconW(operation, ptr(notifyIconData(window.hwnd, uid, hIcon, toolTip)));
    };
    sync(NIM_ADD);

    return {
      setToolTip(value: string): void {
        toolTip = value;
        sync(NIM_MODIFY);
      },
      setTitle(): void {
        // The Windows tray has no inline title text (a macOS NSStatusItem feature).
      },
      setImage(path: string): void {
        const previous = hIcon;
        hIcon = loadTrayIcon(path);
        sync(NIM_MODIFY);
        destroyIconSafely(previous);
      },
      setContextMenu(_menu: Menu | null): void {
        // Deferred (v1): a Win32 HMENU + TrackPopupMenu lands with the menu backend.
      },
      onClick(callback: () => void): void {
        clickCallback = callback;
      },
      destroy(): void {
        if (destroyed) {
          return;
        }
        destroyed = true;
        sync(NIM_DELETE);
        window.destroy();
        destroyIconSafely(hIcon);
      },
      isDestroyed(): boolean {
        return destroyed;
      },
    };
  },
};
