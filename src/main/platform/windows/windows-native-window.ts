import { FFIType, JSCallback, ptr, read } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { cstr } from '../cstr';
import type { WindowEventType } from '../native';
import { wstr } from './win32';
import { loadKernel32, loadOle32, loadUser32 } from './win32-ffi';

/**
 * The top-level + web-host windows for the Windows backend — the WinCairo peer of
 * `NSWindow`/`GtkWindow`.
 *
 * The window that DIRECTLY hosts the WebKit view MUST use a native window
 * procedure: WebKit floods its immediate host with re-entrant messages during a
 * load, which a `bun:ffi` `JSCallback` WndProc cannot survive. So the WebKit view
 * lives in a native-`DefWindowProcW` CHILD ({@link createNativeChildHost}).
 *
 * The TOP-LEVEL frame, by contrast, uses a JSCallback "frame" WndProc — proven
 * safe because the flood stops at the immediate child host and does not propagate
 * up to the parent (see `menu-frame-spike.ts`). The frame proc is what lets a
 * native menu BAR work: menu clicks arrive as `WM_COMMAND` SENT straight to the
 * window proc (never posted to the queue), so they are unreachable from the pump —
 * the frame proc dispatches them to the per-window `menuCommand` handler. Other
 * lifecycle is still routed from the cooperative PUMP: `dispatchPostedWindowMessage`
 * turns the posted `WM_SYSCOMMAND`/`SC_CLOSE` into the preventable `onClose`, and
 * sent-only state (resize/focus/…) is polled by {@link pollWindows}.
 */

const NATIVE_WINDOW_CLASS_NAME = 'BunmaskaNativeWindow';
const FRAME_WINDOW_CLASS_NAME = 'BunmaskaFrameWindow';
const WNDCLASSEXW_SIZE = 80;
const RECT_SIZE = 16;
const IDC_ARROW = 32512;
/** `WM_COMMAND` — a menu selection (or control/accelerator) notification. */
const WM_COMMAND = 0x0111;

const CW_USEDEFAULT = -0x80000000;
const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_THICKFRAME = 0x00040000;
const WS_MAXIMIZEBOX = 0x00010000;

const SW_HIDE = 0;
const SW_SHOW = 5;

/** `WM_NCLBUTTONDOWN` + `HTCAPTION`: tell the system to start moving the window
 *  (used to drag a frameless window from a custom `-webkit-app-region`-style bar). */
const WM_NCLBUTTONDOWN = 0x00a1;
const HTCAPTION = 2;

const WM_SYSCOMMAND = 0x0112;
/** `wParam` low bits for the title-bar Close command. */
const SC_CLOSE = 0xf060;
/** System-command type bits (the low 4 bits are reserved by Windows). */
const SC_MASK = 0xfff0;

let oleInitialized = false;
let classRegistered = false;
// Pinned for the process lifetime: the window class references the name buffer.
let classNameBuffer: Uint8Array | undefined;

/** Initialise COM on this thread once — WinCairo WebKit requires it. */
export const ensureOleInitialized = (): void => {
  if (oleInitialized) {
    return;
  }
  loadOle32().symbols.OleInitialize(null);
  oleInitialized = true;
};

/** Register the shared native-WndProc window class once; return the `HINSTANCE`. */
const ensureNativeWindowClass = (): bigint => {
  const kernel32 = loadKernel32();
  const hInstance = kernel32.symbols.GetModuleHandleW(null);
  if (classRegistered) {
    return hInstance;
  }
  // Use the system DefWindowProcW directly as the class window procedure.
  const user32Module = kernel32.symbols.GetModuleHandleW(ptr(wstr('user32.dll')));
  const defWindowProc = kernel32.symbols.GetProcAddress(user32Module, cstr('DefWindowProcW'));
  if (defWindowProc === 0n) {
    throw new FFIError('GetProcAddress(DefWindowProcW) failed');
  }
  classNameBuffer = wstr(NATIVE_WINDOW_CLASS_NAME);
  const user32 = loadUser32();
  const hCursor = user32.symbols.LoadCursorW(0n, BigInt(IDC_ARROW));
  const wc = new Uint8Array(WNDCLASSEXW_SIZE);
  const dv = new DataView(wc.buffer);
  dv.setUint32(0, WNDCLASSEXW_SIZE, true); // cbSize
  dv.setBigUint64(8, defWindowProc, true); // lpfnWndProc = native DefWindowProcW
  dv.setBigUint64(24, hInstance, true); // hInstance
  dv.setBigUint64(40, hCursor, true); // hCursor
  dv.setBigUint64(64, BigInt(ptr(classNameBuffer)), true); // lpszClassName
  if (user32.symbols.RegisterClassExW(ptr(wc)) === 0) {
    throw new FFIError('RegisterClassExW failed for the Bunmaska window class');
  }
  classRegistered = true;
  return hInstance;
};

// Frame-class shared state: the registered class + its retained JSCallback proc.
let frameClassRegistered = false;
let frameWndProc: JSCallback | undefined;
let frameClassNameBuffer: Uint8Array | undefined;

/**
 * Register the top-level FRAME window class once, wiring a shared JSCallback
 * WndProc. The proc dispatches a menu `WM_COMMAND` (a SENT message the pump can't
 * see) to the owning window's `menuCommand` handler and forwards everything else
 * to `DefWindowProcW`. Safe despite hosting WebKit (in a native child) — see the
 * module header. Returns the `HINSTANCE`.
 */
const ensureFrameWindowClass = (): bigint => {
  const kernel32 = loadKernel32();
  const hInstance = kernel32.symbols.GetModuleHandleW(null);
  if (frameClassRegistered) {
    return hInstance;
  }
  const user32 = loadUser32();
  frameWndProc = new JSCallback(
    (hwnd: bigint, message: number, wParam: bigint, lParam: bigint): bigint => {
      // A menu selection: HIWORD(wParam)=0 and lParam=0 (controls/accelerators differ).
      if (message === WM_COMMAND && lParam === 0n && wParam >> 16n === 0n) {
        const handlers = windowRegistry.get(hwnd);
        if (handlers?.menuCommand !== undefined) {
          try {
            handlers.menuCommand(Number(wParam & 0xffffn));
          } catch {
            // A throwing JS handler must never propagate into the native WndProc.
          }
          return 0n;
        }
      }
      return user32.symbols.DefWindowProcW(hwnd, message, wParam, lParam);
    },
    { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
  );
  const frameWndProcPtr = frameWndProc.ptr;
  if (frameWndProcPtr === null) {
    throw new FFIError('frame window: failed to allocate the WndProc trampoline');
  }
  frameClassNameBuffer = wstr(FRAME_WINDOW_CLASS_NAME);
  const hCursor = user32.symbols.LoadCursorW(0n, BigInt(IDC_ARROW));
  const wc = new Uint8Array(WNDCLASSEXW_SIZE);
  const dv = new DataView(wc.buffer);
  dv.setUint32(0, WNDCLASSEXW_SIZE, true); // cbSize
  dv.setBigUint64(8, BigInt(frameWndProcPtr), true); // lpfnWndProc = JSCallback frame proc
  dv.setBigUint64(24, hInstance, true); // hInstance
  dv.setBigUint64(40, hCursor, true); // hCursor
  dv.setBigUint64(64, BigInt(ptr(frameClassNameBuffer)), true); // lpszClassName
  if (user32.symbols.RegisterClassExW(ptr(wc)) === 0) {
    throw new FFIError('RegisterClassExW failed for the Bunmaska frame class');
  }
  frameClassRegistered = true;
  return hInstance;
};

/** Create the native child window that hosts a WebKit view inside `parentHwnd`. */
export const createNativeChildHost = (
  parentHwnd: bigint,
  width: number,
  height: number,
): bigint => {
  const hInstance = ensureNativeWindowClass();
  const className = classNameBuffer;
  if (className === undefined) {
    throw new FFIError('native window class buffer was not initialised');
  }
  const hwnd = loadUser32().symbols.CreateWindowExW(
    0,
    ptr(className),
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
  /** Fired once after the window is destroyed. */
  onClosed?: () => void;
  /** Non-preventable lifecycle handlers, keyed by event type. */
  readonly events: Map<WindowEventType, () => void>;
  /** Internal resize sink (resizes the hosted view) — fired before the `resize` event. */
  resizeHook?: (width: number, height: number) => void;
  /** Menu-bar command sink: fired by the frame proc with the chosen `WM_COMMAND` id. */
  menuCommand?: (commandId: number) => void;
  /** The current menu-bar HMENU (owned by this window; destroyed when replaced/closed). */
  menuBar?: bigint;
  /** Whether the committed close destroys the window (false = hide; see commitClose). */
  destroyOnClose: boolean;
  /** Last-observed state for the pump's change detection (see {@link pollWindows}). */
  width: number;
  height: number;
  focused: boolean;
  maximized: boolean;
  minimized: boolean;
}

/** A fresh handlers record with zeroed state. */
const newHandlers = (destroyOnClose: boolean): NativeWindowHandlers => ({
  closed: false,
  events: new Map(),
  width: 0,
  height: 0,
  focused: false,
  maximized: false,
  minimized: false,
  destroyOnClose,
});

const windowRegistry = new Map<bigint, NativeWindowHandlers>();

/** Run the committed-close path once: tear down the view, then destroy the window. */
const commitClose = (hwnd: bigint, handlers: NativeWindowHandlers): void => {
  if (handlers.closed) {
    return;
  }
  handlers.closed = true;
  // Detach + free any menu bar this window owns before tearing the window down.
  if (handlers.menuBar !== undefined && handlers.menuBar !== 0n) {
    const user32 = loadUser32().symbols;
    user32.SetMenu(hwnd, 0n);
    user32.DestroyMenu(handlers.menuBar);
    delete handlers.menuBar;
  }
  // Quiesce the hosted view first (the onClosed handler clears WebKit's clients
  // and detaches the view), THEN finish the window.
  handlers.onClosed?.();
  if (handlers.destroyOnClose) {
    loadUser32().symbols.DestroyWindow(hwnd);
  } else {
    // A WebKit-hosting window: synchronously destroying it crashes WebKit's
    // multi-process teardown through bun:ffi, so hide it and let the OS reclaim
    // the view + its WebProcess at process exit (see `.admin/WINDOWS.md`).
    loadUser32().symbols.ShowWindow(hwnd, SW_HIDE);
  }
  windowRegistry.delete(hwnd);
};

/**
 * Route a POSTED message to its window's lifecycle handlers. Called by the pump
 * for every message before it is dispatched; returns `true` when it fully handled
 * the message (the pump then skips the default dispatch). Today it turns the
 * title-bar close (`WM_SYSCOMMAND`/`SC_CLOSE`) into the preventable `onClose`.
 */
export const dispatchPostedWindowMessage = (
  hwnd: bigint,
  message: number,
  wParam: bigint,
): boolean => {
  if (message !== WM_SYSCOMMAND || (Number(wParam) & SC_MASK) !== SC_CLOSE) {
    return false;
  }
  const handlers = windowRegistry.get(hwnd);
  if (handlers === undefined || handlers.closed) {
    return false;
  }
  if (handlers.onClose?.() === true) {
    return true; // vetoed — swallow the close so DefWindowProc never destroys it
  }
  commitClose(hwnd, handlers);
  return true;
};

/**
 * Poll every live window and fire the changed non-preventable lifecycle events
 * (resize / maximize / unmaximize / minimize / restore / focus / blur). Called
 * each pump tick: WebKit's host uses a native WndProc, so these SENT-only state
 * changes never reach the message queue and must be observed by polling. `show`
 * and `hide` are fired directly from {@link NativeWin32Window.show}/`hide`.
 */
export const pollWindows = (): void => {
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
    user32.symbols.GetClientRect(hwnd, rectPtr);
    const width = read.i32(rectPtr, 8);
    const height = read.i32(rectPtr, 12);
    if (width !== h.width || height !== h.height) {
      h.width = width;
      h.height = height;
      h.resizeHook?.(width, height); // keep the hosted view filling the client area
      h.events.get('resize')?.();
    }
    const maximized = user32.symbols.IsZoomed(hwnd) !== 0;
    if (maximized !== h.maximized) {
      h.maximized = maximized;
      h.events.get(maximized ? 'maximize' : 'unmaximize')?.();
    }
    const minimized = user32.symbols.IsIconic(hwnd) !== 0;
    if (minimized !== h.minimized) {
      h.minimized = minimized;
      h.events.get(minimized ? 'minimize' : 'restore')?.();
    }
    const focused = foreground === hwnd;
    if (focused !== h.focused) {
      h.focused = focused;
      h.events.get(focused ? 'focus' : 'blur')?.();
    }
  }
};

/** Win32 window-style word for the framed/resizable options. */
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

/** Options for constructing a {@link NativeWin32Window}. */
export interface NativeWin32WindowOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly show: boolean;
  readonly resizable?: boolean;
  readonly frame?: boolean;
  /** Hide instead of destroy on close (for WebKit-hosting windows). Default true. */
  readonly destroyOnClose?: boolean;
}

/** A live top-level native-WndProc window that can host a WebKit view. */
export class NativeWin32Window {
  readonly #hwnd: bigint;
  readonly #handlers: NativeWindowHandlers = newHandlers(true);

  constructor(options: NativeWin32WindowOptions) {
    this.#handlers.destroyOnClose = options.destroyOnClose ?? true;
    ensureOleInitialized();
    // The TOP-LEVEL frame uses the JSCallback frame class (so a menu bar's
    // WM_COMMAND is dispatchable); the WebKit view lives in a native child.
    const hInstance = ensureFrameWindowClass();
    const className = frameClassNameBuffer;
    if (className === undefined) {
      throw new FFIError('frame window class buffer was not initialised');
    }
    const hwnd = loadUser32().symbols.CreateWindowExW(
      0,
      ptr(className),
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
    this.#handlers.maximized = user32.symbols.IsZoomed(this.#hwnd) !== 0;
    this.#handlers.minimized = user32.symbols.IsIconic(this.#hwnd) !== 0;
  }

  /** The native window handle. */
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

  /** Fire a lifecycle event to its handler (for events not surfaced by polling). */
  emit(type: WindowEventType): void {
    this.#handlers.events.get(type)?.();
  }

  /** Register the internal sink that keeps the hosted view sized to the client area. */
  setResizeHook(hook: (width: number, height: number) => void): void {
    this.#handlers.resizeHook = hook;
  }

  /** Register the handler the frame proc fires for a menu-bar `WM_COMMAND`. */
  onMenuCommand(handler: (commandId: number) => void): void {
    this.#handlers.menuCommand = handler;
  }

  /**
   * Begin an interactive window move — the equivalent of dragging the title bar,
   * for frameless windows with a custom (`-webkit-app-region: drag`-style) bar.
   * Releases mouse capture (the web view's child window holds it after mousedown)
   * and hands off to the system's move loop, so dragging feels native (edge snap,
   * Aero shake, etc.). Called from the renderer over the window-op message channel.
   */
  startWindowDrag(): void {
    const user32 = loadUser32().symbols;
    user32.ReleaseCapture();
    user32.SendMessageW(this.#hwnd, WM_NCLBUTTONDOWN, BigInt(HTCAPTION), 0n);
  }

  /**
   * Attach `menuBar` (an HMENU) as this window's menu bar, or remove it with
   * `null`. Takes ownership: the previous bar is destroyed, and so is this one when
   * the window closes. Adding/removing a bar changes the client area, which the
   * pump's resize poll then propagates to the hosted view.
   */
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
  }

  setTitle(title: string): void {
    loadUser32().symbols.SetWindowTextW(this.#hwnd, ptr(wstr(title)));
  }

  /** The content (client) area size in physical pixels. */
  getClientSize(): { width: number; height: number } {
    const rect = new Uint8Array(RECT_SIZE);
    loadUser32().symbols.GetClientRect(this.#hwnd, ptr(rect));
    const dv = new DataView(rect.buffer);
    return { width: dv.getInt32(8, true), height: dv.getInt32(12, true) };
  }

  show(): void {
    const user32 = loadUser32().symbols;
    user32.ShowWindow(this.#hwnd, SW_SHOW);
    // The process's FIRST ShowWindow can be overridden by the launcher's
    // STARTUPINFO.wShowWindow (e.g. a hidden child process), leaving the window
    // hidden; a second call always honors SW_SHOW.
    if (user32.IsWindowVisible(this.#hwnd) === 0) {
      user32.ShowWindow(this.#hwnd, SW_SHOW);
    }
    this.emit('show');
  }

  hide(): void {
    loadUser32().symbols.ShowWindow(this.#hwnd, SW_HIDE);
    this.emit('hide');
  }

  isVisible(): boolean {
    return loadUser32().symbols.IsWindowVisible(this.#hwnd) !== 0;
  }

  /** Preventable close: consults the veto, then destroys (mirrors the title-bar path). */
  close(): void {
    if (this.#handlers.closed) {
      return;
    }
    if (this.#handlers.onClose?.() === true) {
      return;
    }
    commitClose(this.#hwnd, this.#handlers);
  }

  /** Force-close, bypassing the veto. Idempotent. */
  destroy(): void {
    commitClose(this.#hwnd, this.#handlers);
  }
}
