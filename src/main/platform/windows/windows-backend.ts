import { ptr, read } from 'bun:ffi';
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
import { type AppMenuWindow, windowsMenuRealizer } from './windows-menu';
import { ensureOleInitialized, NativeWin32Window, pollWindows } from './windows-native-window';
import { createWindowsDrain } from './windows-run-loop';
import { WindowsWebContents } from './windows-web-contents';

const SW_MAXIMIZE = 3;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;

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
const WS_CLIPCHILDREN = 0x02000000;
const STYLE_RESIZABLE = 0x00050000n; // WS_THICKFRAME | WS_MAXIMIZEBOX
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;

const TPM_RETURNCMD = 0x0100;
const TPM_RIGHTBUTTON = 0x0002;

/** `style` with the `WS_VISIBLE` bit of `current`: a style swap must never show or hide. */
const keepVisibility = (style: bigint, current: bigint): bigint =>
  (style & ~BigInt(WS_VISIBLE)) | (current & BigInt(WS_VISIBLE));

/** Windows {@link NativeWindow}: a top-level window hosting a WinCairo `WKView`. */
class WindowsWindow implements NativeWindow {
  readonly #native: NativeWin32Window;
  readonly #webContents: WindowsWebContents;
  readonly #appMenuTarget: AppMenuWindow;
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
      // A WebKit host hides on close, never destroys (D043).
      destroyOnClose: false,
      ...(options.resizable !== undefined ? { resizable: options.resizable } : {}),
      ...(options.frame !== undefined ? { frame: options.frame } : {}),
    });
    // options.width/height are the OUTER size (Electron); a view that size is clipped by
    // the frame, and the poll only refits on a change, so start at the client size.
    const client = this.#native.getClientSize();
    this.#webContents = new WindowsWebContents(
      this.#native.hwnd(),
      client.width,
      client.height,
      options.preloadScript,
    );
    this.#native.setResizeHook((width, height) => this.#webContents.resize(width, height));
    this.#appMenuTarget = { setMenuBar: (bar) => this.#native.setMenuBar(bar) };
    this.#native.onMenuCommand((commandId) => windowsMenuRealizer.dispatchMenuCommand(commandId));
    windowsMenuRealizer.registerAppMenuWindow(this.#appMenuTarget);
    this.#webContents.onWindowOp((op) => this.#handleWindowOp(op));
    this.#native.onClosed(() => {
      windowsMenuRealizer.unregisterAppMenuWindow(this.#appMenuTarget);
      try {
        this.#webContents.dispose();
      } finally {
        for (const callback of this.#closedCallbacks) {
          callback();
        }
      }
    });
    // `ready-to-show` fires once, on the first finished load (as on macOS and Linux).
    this.#webContents.onNavigation((event) => {
      if (event.type === 'did-finish-load' && !this.#readyToShown) {
        this.#readyToShown = true;
        this.#native.emit('ready-to-show');
      }
    });
    if (options.fullscreen === true) {
      this.setFullScreen(true);
    }
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

  setPosition(x: number, y: number): void {
    loadUser32().symbols.SetWindowPos(
      this.#hwnd(),
      0n,
      x,
      y,
      0,
      0,
      SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
  }

  setBounds(bounds: Rect): void {
    loadUser32().symbols.SetWindowPos(
      this.#hwnd(),
      0n,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      SWP_NOZORDER | SWP_NOACTIVATE,
    );
  }

  getBounds(): Rect {
    return this.#native.getBounds();
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

  setMinimumSize(width: number, height: number): void {
    this.#native.setMinimumSize(width, height);
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
      this.#fullscreen = true;
      this.#savedStyle = user32.GetWindowLongPtrW(hwnd, GWL_STYLE);
      this.#savedBounds = this.getBounds();
      const fullscreenStyle = BigInt((WS_POPUP | WS_CLIPCHILDREN) >>> 0);
      user32.SetWindowLongPtrW(hwnd, GWL_STYLE, keepVisibility(fullscreenStyle, this.#savedStyle));
      const width = user32.GetSystemMetrics(SM_CXSCREEN);
      const height = user32.GetSystemMetrics(SM_CYSCREEN);
      user32.SetWindowPos(hwnd, 0n, 0, 0, width, height, SWP_NOZORDER | SWP_FRAMECHANGED);
    } else if (!flag && this.#fullscreen) {
      this.#fullscreen = false;
      const current = user32.GetWindowLongPtrW(hwnd, GWL_STYLE);
      user32.SetWindowLongPtrW(hwnd, GWL_STYLE, keepVisibility(this.#savedStyle, current));
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

  /** Apply a window op requested by the renderer's custom title bar. */
  #handleWindowOp(op: string): void {
    switch (op) {
      case 'drag':
        this.#native.startWindowDrag();
        break;
      case 'minimize':
        this.minimize();
        break;
      case 'maximize':
        this.maximize();
        break;
      case 'unmaximize':
        this.unmaximize();
        break;
      case 'toggleMaximize':
        if (this.isMaximized()) {
          this.unmaximize();
        } else {
          this.maximize();
        }
        break;
      case 'close':
        this.close();
        break;
    }
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
    this.#native.onWindowEvent(type, callback);
  }

  popupMenu(menuHandle: bigint, x: number, y: number): void {
    const user32 = loadUser32().symbols;
    const hwnd = this.#hwnd();
    // Convert the content-relative point to screen coordinates (in/out POINT).
    const point = new Uint8Array(8);
    const dv = new DataView(point.buffer);
    dv.setInt32(0, x, true);
    dv.setInt32(4, y, true);
    const pointPtr = ptr(point);
    user32.ClientToScreen(hwnd, pointPtr);
    // Modal: Bun stalls until the menu closes. Returns the command id (0 = dismissed);
    // the realized HMENU is ours to destroy.
    const command = user32.TrackPopupMenu(
      menuHandle,
      TPM_RETURNCMD | TPM_RIGHTBUTTON,
      read.i32(pointPtr, 0),
      read.i32(pointPtr, 4),
      0,
      hwnd,
      null,
    );
    if (command !== 0) {
      windowsMenuRealizer.dispatchMenuCommand(command);
    }
    user32.DestroyMenu(menuHandle);
  }

  closePopupMenu(): void {
    // Only reachable from a native callback while a menu tracks: its modal loop stalls Bun timers.
    loadUser32().symbols.EndMenu();
  }
}

/** Windows {@link NativeApplication}: owns the live windows and drives the cooperative pump. */
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
    // WM_HOTKEY is a thread message with no window proc, so only the drain sees it.
    const drainMessages = createWindowsDrain((_hwnd, message, wParam) =>
      windowsGlobalShortcutBackend.dispatchHotkeyMessage(message, wParam),
    );
    // ponytail: fixed 16ms poll wakes an idle app ~60x/s; upgrade = MsgWaitForMultipleObjectsEx with AdaptiveBlockingPump backoff (D047)
    this.#pump = new CooperativePump(() => {
      drainMessages();
      pollWindows();
    });
    this.#pump.start();
    this.#ready = true;
    for (const callback of this.#readyCallbacks.splice(0)) {
      callback();
    }
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
    this.#windows.clear();
    this.#pump?.stop();
    this.#pump = undefined;
    this.#started = false;
  }
}

export const createWindowsApplication = (): NativeApplication => new WindowsApplication();
