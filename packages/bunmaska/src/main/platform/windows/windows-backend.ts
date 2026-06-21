import { ptr } from 'bun:ffi';
import { CooperativePump } from '../../run-loop';
import type {
  NativeApplication,
  NativeWebContents,
  NativeWindow,
  NativeWindowOptions,
  Rect,
  WindowEventType,
} from '../native';
import { loadUser32 } from './win32-ffi';
import {
  dispatchPostedWindowMessage,
  ensureOleInitialized,
  NativeWin32Window,
} from './windows-native-window';
import { createWindowsDrain } from './windows-run-loop';
import { WindowsWebContents } from './windows-web-contents';

/**
 * Windows {@link NativeApplication} backend on Win32 + WinCairo WebKit, pure
 * `bun:ffi`. Mirrors `linux-backend.ts`/`cocoa-backend.ts` (D024): a thin
 * lifecycle shell over the shared {@link CooperativePump} plus a window factory.
 *
 * The pump drains the Win32 message queue non-blocking (`PeekMessage`, never
 * `GetMessage`) and routes the preventable window close from the queue via
 * {@link dispatchPostedWindowMessage} — there is no JSCallback WndProc, which
 * WebKit's re-entrant message flood would crash (see `windows-native-window.ts`).
 */

const SW_MAXIMIZE = 3;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const RECT_SIZE = 16;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
/** `hWndInsertAfter` sentinels for {@link NativeWindow.setAlwaysOnTop}. */
const HWND_TOPMOST = 0xffffffffffffffffn; // (HWND)-1
const HWND_NOTOPMOST = 0xfffffffffffffffen; // (HWND)-2

/**
 * Windows {@link NativeWindow}: a native top-level window hosting a WinCairo
 * `WKView`. Lifecycle (preventable close) is delegated to {@link NativeWin32Window}
 * (pump-routed); window management is direct Win32; the web view + IPC live in
 * {@link WindowsWebContents}.
 */
class WindowsWindow implements NativeWindow {
  readonly #native: NativeWin32Window;
  readonly #webContents: WindowsWebContents;
  readonly #closedCallbacks: Array<() => void> = [];
  #title: string;
  #fullscreen = false;

  constructor(options: NativeWindowOptions) {
    this.#title = options.title;
    this.#native = new NativeWin32Window({
      title: options.title,
      width: options.width,
      height: options.height,
      show: false,
      ...(options.resizable !== undefined ? { resizable: options.resizable } : {}),
      ...(options.frame !== undefined ? { frame: options.frame } : {}),
    });
    this.#webContents = new WindowsWebContents(
      this.#native.hwnd(),
      options.width,
      options.height,
      options.preloadScript,
    );
    // On the committed-close path, tear down the web contents (reject pending
    // execs, release the view) before surfacing `closed` to the api layer.
    this.#native.onClosed(() => {
      this.#webContents.dispose();
      for (const callback of this.#closedCallbacks) {
        callback();
      }
    });
    if (options.show) {
      this.show();
    }
  }

  get webContents(): NativeWebContents {
    return this.#webContents;
  }

  #hwnd(): bigint {
    return this.#native.hwnd();
  }

  setTitle(title: string): void {
    this.#title = title;
    this.#native.setTitle(title);
  }

  getTitle(): string {
    return this.#title;
  }

  setSize(width: number, height: number): void {
    loadUser32().symbols.SetWindowPos(
      this.#hwnd(),
      0n,
      0,
      0,
      width,
      height,
      SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
  }

  getBounds(): Rect {
    const rect = new Uint8Array(RECT_SIZE);
    loadUser32().symbols.GetWindowRect(this.#hwnd(), ptr(rect));
    const dv = new DataView(rect.buffer);
    const left = dv.getInt32(0, true);
    const top = dv.getInt32(4, true);
    const right = dv.getInt32(8, true);
    const bottom = dv.getInt32(12, true);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  setResizable(_resizable: boolean): void {
    // Toggling WS_THICKFRAME via SetWindowLongPtr; wired in the seam-fill phase.
  }

  setOpacity(_opacity: number): void {
    // WS_EX_LAYERED + SetLayeredWindowAttributes; wired in the seam-fill phase.
  }

  setMinimumSize(_width: number, _height: number): void {
    // Enforced via WM_GETMINMAXINFO from the pump; wired in the seam-fill phase.
  }

  center(): void {
    // Needs screen metrics; wired in the seam-fill phase.
  }

  show(): void {
    this.#native.show();
  }

  hide(): void {
    this.#native.hide();
  }

  isVisible(): boolean {
    return this.#native.isVisible();
  }

  focus(): void {
    loadUser32().symbols.SetForegroundWindow(this.#hwnd());
  }

  isFocused(): boolean {
    return loadUser32().symbols.GetForegroundWindow() === this.#hwnd();
  }

  minimize(): void {
    loadUser32().symbols.ShowWindow(this.#hwnd(), SW_MINIMIZE);
  }

  maximize(): void {
    loadUser32().symbols.ShowWindow(this.#hwnd(), SW_MAXIMIZE);
  }

  unmaximize(): void {
    loadUser32().symbols.ShowWindow(this.#hwnd(), SW_RESTORE);
  }

  isMaximized(): boolean {
    return loadUser32().symbols.IsZoomed(this.#hwnd()) !== 0;
  }

  isMinimized(): boolean {
    return loadUser32().symbols.IsIconic(this.#hwnd()) !== 0;
  }

  restore(): void {
    loadUser32().symbols.ShowWindow(this.#hwnd(), SW_RESTORE);
  }

  setFullScreen(flag: boolean): void {
    // Best-effort until the seam-fill phase swaps the style for true fullscreen.
    this.#fullscreen = flag;
    loadUser32().symbols.ShowWindow(this.#hwnd(), flag ? SW_MAXIMIZE : SW_RESTORE);
  }

  isFullScreen(): boolean {
    return this.#fullscreen;
  }

  setAlwaysOnTop(flag: boolean): void {
    loadUser32().symbols.SetWindowPos(
      this.#hwnd(),
      flag ? HWND_TOPMOST : HWND_NOTOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
    );
  }

  close(): void {
    this.#native.close();
  }

  destroy(): void {
    this.#native.destroy();
  }

  onClosed(callback: () => void): void {
    this.#closedCallbacks.push(callback);
  }

  onClose(callback: () => boolean): void {
    this.#native.onClose(callback);
  }

  onWindowEvent(_type: WindowEventType, _callback: () => void): void {
    // focus/blur/resize/maximize/... are surfaced by pump-polling in the
    // seam-fill phase; the close/closed pair already flows through onClose/onClosed.
  }

  popupMenu(_menuHandle: bigint, _x: number, _y: number): void {
    // Context menus arrive with the menu module (TrackPopupMenu).
  }

  closePopupMenu(): void {
    // See popupMenu.
  }
}

/**
 * Windows {@link NativeApplication}: initializes COM, drives the cooperative pump,
 * and owns the set of live windows.
 */
export class WindowsApplication implements NativeApplication {
  #pump: CooperativePump | undefined;
  #started = false;
  #ready = false;
  readonly #readyCallbacks: Array<() => void> = [];
  readonly #windows = new Set<NativeWindow>();

  start(): void {
    if (this.#started) {
      return;
    }
    ensureOleInitialized();
    this.#started = true;
    this.#ready = true;
    for (const callback of this.#readyCallbacks) {
      callback();
    }
    this.#readyCallbacks.length = 0;
    this.#pump = new CooperativePump(createWindowsDrain(dispatchPostedWindowMessage));
    this.#pump.start();
  }

  onReady(callback: () => void): void {
    if (this.#ready) {
      callback();
      return;
    }
    this.#readyCallbacks.push(callback);
  }

  createWindow(options: NativeWindowOptions): NativeWindow {
    const window = new WindowsWindow(options);
    this.#windows.add(window);
    window.onClosed(() => {
      this.#windows.delete(window);
    });
    return window;
  }

  quit(): void {
    if (!this.#started) {
      return;
    }
    for (const window of [...this.#windows]) {
      window.close();
    }
    this.#windows.clear();
    this.#pump?.stop();
    this.#pump = undefined;
    this.#started = false;
  }
}

/** Construct the Windows {@link NativeApplication}. */
export const createWindowsApplication = (): NativeApplication => new WindowsApplication();
