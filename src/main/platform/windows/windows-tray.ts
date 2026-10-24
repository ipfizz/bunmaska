import { ptr, read } from 'bun:ffi';
import type { TrayBackend, TrayInstance } from '../services';
import { wstr } from './win32';
import { loadUser32 } from './win32-ffi';
import { GDIP_OK, loadGdiplus } from './win32-gdiplus-ffi';
import { loadShell32, NIM_ADD, NIM_DELETE, NIM_MODIFY, notifyIconData } from './win32-shell-ffi';
import { createMessageWindow } from './windows-message-window';
import { windowsMenuRealizer } from './windows-menu';
import { windowsNativeImageBackend } from './windows-native-image';

/** The tray icon's callback message to its hidden message window (WM_APP range). */
export const WM_TRAYICON = 0x8000 + 1;

const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const LR_DEFAULTSIZE = 0x0040;
const IDI_APPLICATION = 32512n;

/** A left mouse button release over the tray icon (the activation gesture). */
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONUP = 0x0205;
const TPM_RIGHTBUTTON = 0x0002;
const TPM_RETURNCMD = 0x0100;

let nextUid = 1;
let taskbarCreated: number | undefined;

/** Broadcast when explorer.exe (re)starts; every tray icon must then be added again. */
const taskbarCreatedMessage = (): number => {
  taskbarCreated ??= loadUser32().symbols.RegisterWindowMessageW(ptr(wstr('TaskbarCreated')));
  return taskbarCreated;
};

/** A left click on icon `uid`: `wParam` is the icon id, LOWORD(lParam) the mouse event. Pure. */
export const isTrayActivation = (
  message: number,
  wParam: number,
  lParam: number,
  uid: number,
): boolean => message === WM_TRAYICON && wParam === uid && (lParam & 0xffff) === WM_LBUTTONUP;

export const isTrayContextMenu = (
  message: number,
  wParam: number,
  lParam: number,
  uid: number,
): boolean => message === WM_TRAYICON && wParam === uid && (lParam & 0xffff) === WM_RBUTTONUP;

/** An HICON plus whether we own it (the stock default icon is shared and never destroyed). */
type TrayIcon = { readonly handle: bigint; readonly owned: boolean };

/** Load `path` as the tray icon: `.ico` natively, PNG and friends via GDI+, else the default. */
export const loadTrayIcon = (path: string): TrayIcon => {
  const user32 = loadUser32().symbols;
  const nameBuf = wstr(path);
  const ico = user32.LoadImageW(
    0n,
    ptr(nameBuf),
    IMAGE_ICON,
    0,
    0,
    LR_LOADFROMFILE | LR_DEFAULTSIZE,
  );
  if (ico !== 0n) {
    return { handle: ico, owned: true };
  }
  const image = windowsNativeImageBackend.decode(path);
  if (!image.empty) {
    const gdip = loadGdiplus().symbols;
    const out = new Uint8Array(8);
    const outPtr = ptr(out);
    const status = gdip.GdipCreateHICONFromBitmap(image.handle, outPtr);
    gdip.GdipDisposeImage(image.handle);
    const hIcon = status === GDIP_OK ? read.u64(outPtr, 0) : 0n;
    if (hIcon !== 0n) {
      return { handle: hIcon, owned: true };
    }
  }
  return { handle: user32.LoadIconW(0n, IDI_APPLICATION), owned: false };
};

const releaseIcon = (icon: TrayIcon): void => {
  if (icon.owned) {
    loadUser32().symbols.DestroyIcon(icon.handle);
  }
};

export const windowsTrayBackend: TrayBackend = {
  create(image: string): TrayInstance {
    const uid = nextUid++;
    const shell32 = loadShell32().symbols;
    let clickCallback: (() => void) | undefined;
    let contextMenu: { realize(): bigint } | null = null;
    let icon = loadTrayIcon(image);
    let toolTip = '';
    let destroyed = false;

    const popupContextMenu = (): void => {
      if (contextMenu === null) {
        return;
      }
      const handle = contextMenu.realize();
      const point = new Uint8Array(8);
      const pointPtr = ptr(point);
      loadUser32().symbols.GetCursorPos(pointPtr);
      const command = loadUser32().symbols.TrackPopupMenu(
        handle,
        TPM_RETURNCMD | TPM_RIGHTBUTTON,
        read.i32(pointPtr, 0),
        read.i32(pointPtr, 4),
        0,
        window.hwnd,
        null,
      );
      if (command !== 0) {
        windowsMenuRealizer.dispatchMenuCommand(command, {
          setMenuBar: () => undefined,
          performWindowAction: () => undefined,
        });
      }
      loadUser32().symbols.DestroyMenu(handle);
    };

    const readdMessage = taskbarCreatedMessage();
    const window = createMessageWindow((message, wParam, lParam) => {
      if (isTrayActivation(message, Number(wParam), Number(lParam), uid)) {
        clickCallback?.();
      } else if (isTrayContextMenu(message, Number(wParam), Number(lParam), uid)) {
        popupContextMenu();
      } else if (message === readdMessage && readdMessage !== 0 && !destroyed) {
        sync(NIM_ADD);
      }
    });

    const sync = (operation: number): void => {
      const nid = notifyIconData({
        hwnd: window.hwnd,
        uid,
        callbackMessage: WM_TRAYICON,
        hIcon: icon.handle,
        tip: toolTip,
      });
      shell32.Shell_NotifyIconW(operation, ptr(nid));
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
        const previous = icon;
        icon = loadTrayIcon(path);
        sync(NIM_MODIFY);
        releaseIcon(previous);
      },
      setContextMenu(menu): void {
        contextMenu = menu;
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
        releaseIcon(icon);
      },
      isDestroyed(): boolean {
        return destroyed;
      },
    };
  },
};
