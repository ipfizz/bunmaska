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
import { windowsGlobalShortcutBackend } from './windows-global-shortcut';
import {
  dispatchPostedWindowMessage,
  ensureOleInitialized,
  NativeWin32Window,
  pollWindows,
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
const SWP_FRAMECHANGED = 0x0020;
/** `hWndInsertAfter` sentinels for {@link NativeWindow.setAlwaysOnTop}. */
const HWND_TOPMOST = 0xffffffffffffffffn; // (HWND)-1
const HWND_NOTOPMOST = 0xfffffffffffffffen; // (HWND)-2

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_EX_LAYERED = 0x00080000n;
const LWA_ALPHA = 0x02;
const WS_POPUP = 0x80000000;
const WS_VISIBLE = 0x10000000;
const STYLE_RESIZABLE = 0x00050000n; // WS_THICKFRAME | WS_MAXIMIZEBOX
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;

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
  #readyToShown = false;
  #savedStyle = 0n;
  #savedBounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(options: NativeWindowOptions) {
    this.#title = options.title;
    this.#native = new NativeWin32Window({
      title: options.title,
      width: options.width,
      height: options.height,
      show: false,
      // Hosts a WebKit view: hide on close rather than destroy (see commitClose).
      destroyOnClose: false,
      ...(options.resizable !== undefined ? { resizable: options.resizable } : {}),
      ...(options.frame !== undefined ? { frame: options.frame } : {}),
    });
    this.#webContents = new WindowsWebContents(
      this.#native.hwnd(),
      options.width,
      options.height,
      options.preloadScript,
    );
    // Keep the hosted view filling the window's client area as it resizes.
    this.#native.setResizeHook((width, height) => this.#webContents.resize(width, height));
    // On the committed-close path, tear down the web contents (reject pending
    // execs, release the view) before surfacing `closed` to the api layer.
    this.#native.onClosed(() => {
      this.#webContents.dispose();
      for (const callback of this.#closedCallbacks) {
        callback();
      }
    });
    // `ready-to-show` fires once, when the page first reaches dom-ready.
    this.#webContents.onNavigation((event) => {
      if (event.type === 'dom-ready' && !this.#readyToShown) {
        this.#readyToShown = true;
        this.#native.emit('ready-to-show');
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

  setResizable(resizable: boolean): void {
    const user32 = loadUser32().symbols;
    const hwnd = this.#hwnd();
    const style = user32.GetWindowLongPtrW(hwnd, GWL_STYLE);
    const next = resizable ? style | STYLE_RESIZABLE : style & ~STYLE_RESIZABLE;
    user32.SetWindowLongPtrW(hwnd, GWL_STYLE, next);
    user32.SetWindowPos(
      hwnd,
      0n,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
    );
  }

  setOpacity(opacity: number): void {
    const user32 = loadUser32().symbols;
    const hwnd = this.#hwnd();
    const exStyle = user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    user32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, exStyle | WS_EX_LAYERED);
    const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)));
    user32.SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA);
  }

  setMinimumSize(_width: number, _height: number): void {
    // A true minimum requires WM_GETMINMAXINFO, which a native-WndProc window
    // cannot intercept from the pump; left for a poll-based follow-up.
  }

  center(): void {
    const user32 = loadUser32().symbols;
    const screenWidth = user32.GetSystemMetrics(SM_CXSCREEN);
    const screenHeight = user32.GetSystemMetrics(SM_CYSCREEN);
    const bounds = this.getBounds();
    const x = Math.max(0, Math.floor((screenWidth - bounds.width) / 2));
    const y = Math.max(0, Math.floor((screenHeight - bounds.height) / 2));
    user32.SetWindowPos(this.#hwnd(), 0n, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
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
    const user32 = loadUser32().symbols;
    const hwnd = this.#hwnd();
    if (flag && !this.#fullscreen) {
      // Save the framed style + bounds, then go borderless over the primary screen.
      this.#fullscreen = true;
      this.#savedStyle = user32.GetWindowLongPtrW(hwnd, GWL_STYLE);
      this.#savedBounds = this.getBounds();
      user32.SetWindowLongPtrW(hwnd, GWL_STYLE, BigInt((WS_POPUP | WS_VISIBLE | 0x02000000) >>> 0));
      const width = user32.GetSystemMetrics(SM_CXSCREEN);
      const height = user32.GetSystemMetrics(SM_CYSCREEN);
      user32.SetWindowPos(hwnd, 0n, 0, 0, width, height, SWP_NOZORDER | SWP_FRAMECHANGED);
    } else if (!flag && this.#fullscreen) {
      this.#fullscreen = false;
      user32.SetWindowLongPtrW(hwnd, GWL_STYLE, this.#savedStyle);
      const b = this.#savedBounds;
      user32.SetWindowPos(hwnd, 0n, b.x, b.y, b.width, b.height, SWP_NOZORDER | SWP_FRAMECHANGED);
    }
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

  onWindowEvent(type: WindowEventType, callback: () => void): void {
    // focus/blur/resize/maximize/minimize/restore are surfaced by the pump poll
    // (pollWindows); show/hide fire from the window directly; ready-to-show fires
    // on the first dom-ready. The close/closed pair flows through onClose/onClosed.
    this.#native.onWindowEvent(type, callback);
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
    // Each tick: drain the message queue (routing the preventable close and the
    // global-shortcut WM_HOTKEY), then poll window state to surface the sent-only
    // lifecycle events.
    const drainMessages = createWindowsDrain(
      (hwnd, message, wParam) =>
        dispatchPostedWindowMessage(hwnd, message, wParam) ||
        windowsGlobalShortcutBackend.dispatchHotkeyMessage(message, wParam),
    );
    this.#pump = new CooperativePump(() => {
      drainMessages();
      pollWindows();
    });
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
