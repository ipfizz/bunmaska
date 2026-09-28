import { FFIType, JSCallback, type Pointer, ptr, read, toArrayBuffer } from 'bun:ffi';
import { isDevRestart } from '../../dev-reload';
import { FFIError } from '../../../common/errors';
import { cstr } from '../cstr';
import type { Rect, WindowEventType } from '../native';
import { readRect, registerWindowClass, wstr } from './win32';
import { loadKernel32, loadOle32, loadUser32 } from './win32-ffi';
import { monitorRectsForWindow } from './windows-screen';

// The WKView's direct host must keep the native DefWindowProcW: WebKit's re-entrant
// flood during a load crashes a JSCallback WndProc (D043). Only the top-level frame,
// above that native child, runs a JSCallback proc.

const NATIVE_WINDOW_CLASS_NAME = 'BunmaskaNativeWindow';
const FRAME_WINDOW_CLASS_NAME = 'BunmaskaFrameWindow';
const RECT_SIZE = 16;
/** `sizeof(WINDOWPLACEMENT)`: length, flags, showCmd, two POINTs, then rcNormalPosition@28. */
const WINDOWPLACEMENT_SIZE = 44;
const RC_NORMAL_POSITION_OFFSET = 28;
const IDC_ARROW = 32512;
const WM_COMMAND = 0x0111;
const WM_CLOSE = 0x0010;
const WM_GETMINMAXINFO = 0x0024;
/** `MINMAXINFO` is five POINTs; ptMinTrackSize is the fourth (x@24, y@28). */
const MINMAXINFO_SIZE = 40;

const CW_USEDEFAULT = -0x80000000;
const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_THICKFRAME = 0x00040000;
const WS_MAXIMIZEBOX = 0x00010000;

const SW_HIDE = 0;
const SW_SHOWNOACTIVATE = 4;
const SW_SHOW = 5;

const WM_NCLBUTTONDOWN = 0x00a1;
const HTCAPTION = 2;

let oleInitialized = false;
let classRegistered = false;

/** Initialise OLE on this thread once; WinCairo WebKit requires it. */
export const ensureOleInitialized = (): void => {
  if (oleInitialized) {
    return;
  }
  // S_FALSE (already initialised) is fine; RPC_E_CHANGED_MODE (an MTA thread) is not.
  const hr = loadOle32().symbols.OleInitialize(null);
  if (hr < 0) {
    throw new FFIError(`OleInitialize failed: 0x${(hr >>> 0).toString(16)}`);
  }
  oleInitialized = true;
};

const ensureNativeWindowClass = (): bigint => {
  const kernel32 = loadKernel32();
  const hInstance = kernel32.symbols.GetModuleHandleW(null);
  if (classRegistered) {
    return hInstance;
  }
  // The class proc IS the native DefWindowProcW, never a JSCallback (D043).
  const user32Module = kernel32.symbols.GetModuleHandleW(ptr(wstr('user32.dll')));
  const defWindowProc = kernel32.symbols.GetProcAddress(user32Module, cstr('DefWindowProcW'));
  if (defWindowProc === 0n) {
    throw new FFIError('GetProcAddress(DefWindowProcW) failed');
  }
  const user32 = loadUser32().symbols;
  const hCursor = user32.LoadCursorW(0n, BigInt(IDC_ARROW));
  registerWindowClass(user32, NATIVE_WINDOW_CLASS_NAME, defWindowProc, hInstance, hCursor);
  classRegistered = true;
  return hInstance;
};

let frameClassRegistered = false;
// Retained for the process: the registered class calls this proc until exit.
let frameWndProc: JSCallback | undefined;

/** Register the top-level frame class and its JSCallback proc once; returns the `HINSTANCE`. */
const ensureFrameWindowClass = (): bigint => {
  const kernel32 = loadKernel32();
  const hInstance = kernel32.symbols.GetModuleHandleW(null);
  if (frameClassRegistered) {
    return hInstance;
  }
  const user32 = loadUser32();
  frameWndProc = new JSCallback(
    (hwnd: bigint, message: number, wParam: bigint, lParam: bigint): bigint => {
      let handled: boolean;
      try {
        handled = handleFrameMessage(hwnd, message, wParam, lParam);
      } catch {
        // A throwing JS handler must never propagate into the native WndProc.
        handled = true;
      }
      return handled ? 0n : user32.symbols.DefWindowProcW(hwnd, message, wParam, lParam);
    },
    { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
  );
  const frameWndProcPtr = frameWndProc.ptr;
  if (frameWndProcPtr === null) {
    throw new FFIError('frame window: failed to allocate the WndProc trampoline');
  }
  const hCursor = user32.symbols.LoadCursorW(0n, BigInt(IDC_ARROW));
  registerWindowClass(
    user32.symbols,
    FRAME_WINDOW_CLASS_NAME,
    BigInt(frameWndProcPtr),
    hInstance,
    hCursor,
  );
  frameClassRegistered = true;
  return hInstance;
};

export const createNativeChildHost = (
  parentHwnd: bigint,
  width: number,
  height: number,
): bigint => {
  const hInstance = ensureNativeWindowClass();
  const hwnd = loadUser32().symbols.CreateWindowExW(
    0,
    ptr(wstr(NATIVE_WINDOW_CLASS_NAME)),
    ptr(wstr('')),
    (WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN) >>> 0,
    0,
    0,
    width,
    height,
    parentHwnd,
    0n,
    hInstance,
    null,
  );
  if (hwnd === 0n) {
    throw new FFIError('CreateWindowExW returned NULL for the web-host child');
  }
  return hwnd;
};

/** Per-window lifecycle handlers, shared by reference with the registry. */
interface NativeWindowHandlers {
  /** True once the committed-close path has run, so teardown fires once. */
  closed: boolean;
  /** Preventable close: return `true` to veto (the window stays open). */
  onClose?: () => boolean;
  /** Fired once, before the window is hidden or destroyed. */
  onClosed?: () => void;
  readonly events: Map<WindowEventType, () => void>;
  /** Refits the hosted view; runs before the `resize` event. */
  resizeHook?: (width: number, height: number) => void;
  /** Minimum outer size in pixels; 0 leaves the system default. */
  minWidth: number;
  minHeight: number;
  /** Menu-bar command sink: fired by the frame proc with the chosen `WM_COMMAND` id. */
  menuCommand?: (commandId: number) => void;
  /** The current menu-bar HMENU (owned by this window; destroyed when replaced/closed). */
  menuBar?: bigint;
  /** Whether the committed close destroys the window (false = hide; see commitClose). */
  destroyOnClose: boolean;
  /** Last-observed state for the pump's change detection (see {@link pollWindows}). */
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
  maximized: boolean;
  minimized: boolean;
}

const newHandlers = (destroyOnClose: boolean): NativeWindowHandlers => ({
  closed: false,
  events: new Map(),
  minWidth: 0,
  minHeight: 0,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  focused: false,
  maximized: false,
  minimized: false,
  destroyOnClose,
});

const windowRegistry = new Map<bigint, NativeWindowHandlers>();

/** Frame-proc messages handled here; `false` falls through to `DefWindowProcW`. */
const handleFrameMessage = (
  hwnd: bigint,
  message: number,
  wParam: bigint,
  lParam: bigint,
): boolean => {
  const handlers = windowRegistry.get(hwnd);
  if (message === WM_CLOSE) {
    // Never forward: DefWindowProcW would DestroyWindow a live WebKit host (D043).
    if (handlers !== undefined) {
      requestClose(hwnd, handlers);
    }
    return true;
  }
  if (message === WM_GETMINMAXINFO && handlers !== undefined) {
    const info = new Int32Array(toArrayBuffer(Number(lParam) as Pointer, 0, MINMAXINFO_SIZE));
    if (handlers.minWidth > 0) {
      info[6] = handlers.minWidth;
    }
    if (handlers.minHeight > 0) {
      info[7] = handlers.minHeight;
    }
    return false;
  }
  // A menu selection: HIWORD(wParam)=0 and lParam=0 (controls/accelerators differ).
  if (
    message === WM_COMMAND &&
    lParam === 0n &&
    wParam >> 16n === 0n &&
    handlers?.menuCommand !== undefined
  ) {
    handlers.menuCommand(Number(wParam & 0xffffn));
    return true;
  }
  return false;
};

/** Consult the veto, then commit; a no-op once closed. */
const requestClose = (hwnd: bigint, handlers: NativeWindowHandlers): void => {
  if (handlers.closed || handlers.onClose?.() === true) {
    return;
  }
  commitClose(hwnd, handlers);
};

/** Run the committed close once: onClosed quiesces the view, then the window hides or goes. */
const commitClose = (hwnd: bigint, handlers: NativeWindowHandlers): void => {
  if (handlers.closed) {
    return;
  }
  handlers.closed = true;
  if (handlers.menuBar !== undefined && handlers.menuBar !== 0n) {
    const user32 = loadUser32().symbols;
    user32.SetMenu(hwnd, 0n);
    user32.DestroyMenu(handlers.menuBar);
    delete handlers.menuBar;
  }
  try {
    handlers.onClosed?.();
  } finally {
    if (handlers.destroyOnClose) {
      loadUser32().symbols.DestroyWindow(hwnd);
    } else {
      // Never DestroyWindow a live WebKit host: its teardown crashes through bun:ffi (D043).
      loadUser32().symbols.ShowWindow(hwnd, SW_HIDE);
    }
    windowRegistry.delete(hwnd);
  }
};

/** Fire the changed lifecycle events of every live window; `show`/`hide` fire from the window. */
export const pollWindows = (): void => {
  // ponytail: polled per tick, so modal move/size loops defer events to mouse-up; upgrade = WM_SIZE/WM_MOVE in the frame proc, after an engine run
  if (windowRegistry.size === 0) {
    return;
  }
  const user32 = loadUser32();
  const foreground = user32.symbols.GetForegroundWindow();
  const rect = new Uint8Array(RECT_SIZE);
  const rectPtr = ptr(rect);
  for (const [hwnd, h] of windowRegistry) {
    if (h.closed) {
      continue;
    }
    const minimized = user32.symbols.IsIconic(hwnd) !== 0;
    if (minimized !== h.minimized) {
      h.minimized = minimized;
      h.events.get(minimized ? 'minimize' : 'restore')?.();
    }
    // An iconic window's client rect is 0x0: never size the view (or fire resize) from it.
    if (!minimized) {
      user32.symbols.GetClientRect(hwnd, rectPtr);
      const width = read.i32(rectPtr, 8);
      const height = read.i32(rectPtr, 12);
      if (width !== h.width || height !== h.height) {
        h.width = width;
        h.height = height;
        h.resizeHook?.(width, height);
        h.events.get('resize')?.();
      }
      user32.symbols.GetWindowRect(hwnd, rectPtr);
      const x = read.i32(rectPtr, 0);
      const y = read.i32(rectPtr, 4);
      if (x !== h.x || y !== h.y) {
        h.x = x;
        h.y = y;
        h.events.get('move')?.();
      }
    }
    const maximized = user32.symbols.IsZoomed(hwnd) !== 0;
    if (maximized !== h.maximized) {
      h.maximized = maximized;
      h.events.get(maximized ? 'maximize' : 'unmaximize')?.();
    }
    const focused = foreground === hwnd;
    if (focused !== h.focused) {
      h.focused = focused;
      h.events.get(focused ? 'focus' : 'blur')?.();
    }
  }
};

const computeStyle = (frame: boolean | undefined, resizable: boolean | undefined): number => {
  let style = WS_CLIPCHILDREN;
  if (frame === false) {
    style |= WS_POPUP;
  } else {
    style |= WS_OVERLAPPEDWINDOW;
    if (resizable === false) {
      style &= ~(WS_THICKFRAME | WS_MAXIMIZEBOX);
    }
  }
  return style >>> 0;
};

export interface NativeWin32WindowOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly show: boolean;
  readonly resizable?: boolean;
  readonly frame?: boolean;
  /** Default true; `false` hides on close instead, as a WebKit host requires (D043). */
  readonly destroyOnClose?: boolean;
}

/** A top-level frame window; a WebKit view goes in its {@link createNativeChildHost} child. */
export class NativeWin32Window {
  readonly #hwnd: bigint;
  readonly #handlers: NativeWindowHandlers;

  constructor(options: NativeWin32WindowOptions) {
    this.#handlers = newHandlers(options.destroyOnClose ?? true);
    ensureOleInitialized();
    const hInstance = ensureFrameWindowClass();
    const hwnd = loadUser32().symbols.CreateWindowExW(
      0,
      ptr(wstr(FRAME_WINDOW_CLASS_NAME)),
      ptr(wstr(options.title)),
      computeStyle(options.frame, options.resizable),
      CW_USEDEFAULT,
      0,
      options.width,
      options.height,
      0n,
      0n,
      hInstance,
      null,
    );
    if (hwnd === 0n) {
      throw new FFIError('CreateWindowExW returned NULL');
    }
    this.#hwnd = hwnd;
    windowRegistry.set(hwnd, this.#handlers);
    this.#captureInitialState();
    if (options.show) {
      this.show();
    }
  }

  /** Seed the tracked state so the first {@link pollWindows} sees no spurious change. */
  #captureInitialState(): void {
    const user32 = loadUser32();
    const rect = new Uint8Array(RECT_SIZE);
    const rectPtr = ptr(rect);
    user32.symbols.GetClientRect(this.#hwnd, rectPtr);
    this.#handlers.width = read.i32(rectPtr, 8);
    this.#handlers.height = read.i32(rectPtr, 12);
    user32.symbols.GetWindowRect(this.#hwnd, rectPtr);
    this.#handlers.x = read.i32(rectPtr, 0);
    this.#handlers.y = read.i32(rectPtr, 4);
    this.#handlers.maximized = user32.symbols.IsZoomed(this.#hwnd) !== 0;
    this.#handlers.minimized = user32.symbols.IsIconic(this.#hwnd) !== 0;
  }

  hwnd(): bigint {
    return this.#hwnd;
  }

  onClose(callback: () => boolean): void {
    this.#handlers.onClose = callback;
  }

  onClosed(callback: () => void): void {
    this.#handlers.onClosed = callback;
  }

  /** Register a non-preventable lifecycle handler (fired by the pump poll). */
  onWindowEvent(type: WindowEventType, callback: () => void): void {
    this.#handlers.events.set(type, callback);
  }

  /** Fire a lifecycle event the poll does not observe. */
  emit(type: WindowEventType): void {
    this.#handlers.events.get(type)?.();
  }

  /** Enforced through `WM_GETMINMAXINFO`; 0 leaves that dimension unconstrained. */
  setMinimumSize(width: number, height: number): void {
    this.#handlers.minWidth = width;
    this.#handlers.minHeight = height;
  }

  setResizeHook(hook: (width: number, height: number) => void): void {
    this.#handlers.resizeHook = hook;
  }

  /** Register the handler the frame proc fires for a menu-bar `WM_COMMAND`. */
  onMenuCommand(handler: (commandId: number) => void): void {
    this.#handlers.menuCommand = handler;
  }

  /** Hand a frameless title-bar drag to the system move loop (D045); the view holds the capture. */
  startWindowDrag(): void {
    const user32 = loadUser32().symbols;
    user32.ReleaseCapture();
    user32.SendMessageW(this.#hwnd, WM_NCLBUTTONDOWN, BigInt(HTCAPTION), 0n);
  }

  /** Attach an HMENU bar, or `null` to remove it; owned from here, destroyed when replaced or closed. */
  setMenuBar(menuBar: bigint | null): void {
    const user32 = loadUser32().symbols;
    const previous = this.#handlers.menuBar;
    user32.SetMenu(this.#hwnd, menuBar ?? 0n);
    user32.DrawMenuBar(this.#hwnd);
    if (previous !== undefined && previous !== 0n && previous !== menuBar) {
      user32.DestroyMenu(previous);
    }
    if (menuBar === null) {
      delete this.#handlers.menuBar;
    } else {
      this.#handlers.menuBar = menuBar;
    }
    // The bar resizes the client area, not the window: refit the view without a 'resize'.
    if (user32.IsIconic(this.#hwnd) === 0) {
      const { width, height } = this.getClientSize();
      this.#handlers.width = width;
      this.#handlers.height = height;
      this.#handlers.resizeHook?.(width, height);
    }
  }

  setTitle(title: string): void {
    loadUser32().symbols.SetWindowTextW(this.#hwnd, ptr(wstr(title)));
  }

  /** The content (client) area size in physical pixels. */
  getClientSize(): { width: number; height: number } {
    const rect = new Uint8Array(RECT_SIZE);
    const rectPtr = ptr(rect);
    loadUser32().symbols.GetClientRect(this.#hwnd, rectPtr);
    return { width: read.i32(rectPtr, 8), height: read.i32(rectPtr, 12) };
  }

  /** Outer bounds in screen pixels; while minimized, the restored rect (Electron on Windows). */
  getBounds(): Rect {
    const user32 = loadUser32().symbols;
    if (user32.IsIconic(this.#hwnd) !== 0) {
      const placement = new Uint8Array(WINDOWPLACEMENT_SIZE);
      new DataView(placement.buffer).setUint32(0, WINDOWPLACEMENT_SIZE, true);
      const placementPtr = ptr(placement);
      user32.GetWindowPlacement(this.#hwnd, placementPtr);
      // rcNormalPosition is in workspace coords, offset by a top- or left-docked taskbar.
      const restored = readRect(placementPtr, RC_NORMAL_POSITION_OFFSET);
      const { bounds, workArea } = monitorRectsForWindow(this.#hwnd);
      return {
        ...restored,
        x: restored.x + workArea.x - bounds.x,
        y: restored.y + workArea.y - bounds.y,
      };
    }
    const rect = new Uint8Array(RECT_SIZE);
    const rectPtr = ptr(rect);
    user32.GetWindowRect(this.#hwnd, rectPtr);
    return readRect(rectPtr, 0);
  }

  show(): void {
    const user32 = loadUser32().symbols;
    // A dev respawn must not take focus from the editor.
    const mode = isDevRestart() ? SW_SHOWNOACTIVATE : SW_SHOW;
    user32.ShowWindow(this.#hwnd, mode);
    // The process's FIRST ShowWindow can be overridden by the launcher's
    // STARTUPINFO.wShowWindow (e.g. a hidden child process), leaving the window
    // hidden; a second call always honors SW_SHOW.
    if (user32.IsWindowVisible(this.#hwnd) === 0) {
      user32.ShowWindow(this.#hwnd, mode);
    }
    this.emit('show');
  }

  hide(): void {
    loadUser32().symbols.ShowWindow(this.#hwnd, SW_HIDE);
    this.emit('hide');
  }

  /** Shown and not minimized (Electron's Windows semantics). */
  isVisible(): boolean {
    const user32 = loadUser32().symbols;
    return user32.IsWindowVisible(this.#hwnd) !== 0 && user32.IsIconic(this.#hwnd) === 0;
  }

  /** Preventable close: consults the veto, then commits (the same path as `WM_CLOSE`). */
  close(): void {
    requestClose(this.#hwnd, this.#handlers);
  }

  /** Force-close, bypassing the veto. Idempotent. */
  destroy(): void {
    commitClose(this.#hwnd, this.#handlers);
  }
}
