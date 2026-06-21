import { ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { cstr } from '../cstr';
import { wstr } from './win32';
import { loadKernel32, loadOle32, loadUser32 } from './win32-ffi';

/**
 * The native-WndProc top-level window for the Windows backend — the WinCairo peer
 * of `NSWindow`/`GtkWindow`. The window WebKit is hosted in MUST use a native
 * window procedure: WebKit floods its host (and the host's ancestors) with
 * re-entrant messages during a load, which a `bun:ffi` `JSCallback` WndProc
 * cannot survive. So the window class uses the system `DefWindowProcW` directly,
 * and lifecycle events are routed from the cooperative message PUMP instead of a
 * WndProc — `dispatchPostedWindowMessage` inspects each posted message and turns
 * `WM_SYSCOMMAND`/`SC_CLOSE` into the preventable `onClose`. (Sent-only events
 * such as resize are polled; added in the seam-fill phase.)
 */

const NATIVE_WINDOW_CLASS_NAME = 'BunmaskaNativeWindow';
const WNDCLASSEXW_SIZE = 80;
const RECT_SIZE = 16;
const IDC_ARROW = 32512;

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
}

const windowRegistry = new Map<bigint, NativeWindowHandlers>();

/** Run the committed-close path once: destroy the window and fire `onClosed`. */
const commitClose = (hwnd: bigint, handlers: NativeWindowHandlers): void => {
  if (handlers.closed) {
    return;
  }
  handlers.closed = true;
  loadUser32().symbols.DestroyWindow(hwnd);
  handlers.onClosed?.();
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
}

/** A live top-level native-WndProc window that can host a WebKit view. */
export class NativeWin32Window {
  readonly #hwnd: bigint;
  readonly #handlers: NativeWindowHandlers = { closed: false };

  constructor(options: NativeWin32WindowOptions) {
    ensureOleInitialized();
    const hInstance = ensureNativeWindowClass();
    const className = classNameBuffer;
    if (className === undefined) {
      throw new FFIError('native window class buffer was not initialised');
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
    if (options.show) {
      this.show();
    }
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
    loadUser32().symbols.ShowWindow(this.#hwnd, SW_SHOW);
  }

  hide(): void {
    loadUser32().symbols.ShowWindow(this.#hwnd, SW_HIDE);
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
