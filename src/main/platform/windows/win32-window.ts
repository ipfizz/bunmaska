import { FFIType, JSCallback, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { wstr } from './win32';
import { loadKernel32, loadUser32 } from './win32-ffi';

/**
 * The engine-agnostic top-level Win32 window — a `GtkWindow`/`NSWindow` peer that
 * hosts nothing yet. The Windows backend (`windows-backend.ts`) composes one of
 * these with a web-view content child; this file owns only the HWND lifecycle.
 *
 * Message routing is single-process and pointer-free: one shared `WndProc`
 * (a retained {@link JSCallback}) looks each window up in {@link windowRegistry}
 * by its HWND and dispatches to that window's JS handlers — no `GWLP_USERDATA`
 * round-trip. The trampoline and the class-name buffer are retained for the
 * process lifetime because the registered window class references them forever
 * (never close a JSCallback that the OS may still call — the same lifetime rule
 * the macOS/Linux backends follow).
 */

const WINDOW_CLASS_NAME = 'BunmaskaWindow';
const WNDCLASSEXW_SIZE = 80;
const RECT_SIZE = 16;

const IDC_ARROW = 32512;
const CS_VREDRAW = 0x0001;
const CS_HREDRAW = 0x0002;
/** Let the system place the window; with a real width/height, only x is honoured. */
const CW_USEDEFAULT = -0x80000000;

const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const WS_POPUP = 0x80000000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_THICKFRAME = 0x00040000;
const WS_MAXIMIZEBOX = 0x00010000;

const SW_HIDE = 0;
const SW_SHOW = 5;

const WM_DESTROY = 0x0002;
const WM_SIZE = 0x0005;
const WM_SETFOCUS = 0x0007;
const WM_KILLFOCUS = 0x0008;
const WM_CLOSE = 0x0010;

/** Per-window JS handlers, shared by reference with the {@link windowRegistry}. */
interface Win32WindowHandlers {
  /** True once `WM_DESTROY` has run, so teardown fires exactly once. */
  closed: boolean;
  /** Preventable close: return `true` to veto (the window stays open). */
  onClose?: () => boolean;
  /** Fired once after the window is destroyed. */
  onClosed?: () => void;
  onResize?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** HWND -> handlers, so the shared WndProc can route a message to its window. */
const windowRegistry = new Map<bigint, Win32WindowHandlers>();

// Retained for the process lifetime (see file header).
let wndProcCallback: JSCallback | undefined;
let classNameBuffer: Uint8Array | undefined;
let classRegistered = false;

/**
 * The shared window procedure. Routes the preventable close, the committed-close
 * teardown, and the non-preventable lifecycle notifications to the window's JS
 * handlers; everything else (and the notifications, after their handler) falls
 * through to `DefWindowProc`.
 */
const wndProc = (hwndArg: bigint, msg: number, wParam: bigint, lParam: bigint): bigint => {
  const user32 = loadUser32();
  const hwnd = BigInt(hwndArg);
  const handlers = windowRegistry.get(hwnd);
  if (handlers !== undefined) {
    switch (msg) {
      case WM_CLOSE:
        if (handlers.onClose?.() === true) {
          return 0n; // vetoed — leave the window alive
        }
        user32.symbols.DestroyWindow(hwnd); // -> WM_DESTROY
        return 0n;
      case WM_DESTROY:
        if (!handlers.closed) {
          handlers.closed = true;
          handlers.onClosed?.();
        }
        windowRegistry.delete(hwnd);
        return 0n;
      case WM_SIZE:
        handlers.onResize?.();
        break;
      case WM_SETFOCUS:
        handlers.onFocus?.();
        break;
      case WM_KILLFOCUS:
        handlers.onBlur?.();
        break;
      default:
        break;
    }
  }
  return user32.symbols.DefWindowProcW(hwnd, msg, wParam, lParam);
};

/** Register the shared window class once and return the running `HINSTANCE`. */
const ensureWindowClass = (): bigint => {
  const hInstance = loadKernel32().symbols.GetModuleHandleW(null);
  if (classRegistered) {
    return hInstance;
  }
  const user32 = loadUser32();
  wndProcCallback = new JSCallback(wndProc, {
    args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.i64,
  });
  const procPtr = wndProcCallback.ptr;
  if (procPtr === null) {
    throw new FFIError('failed to allocate the Win32 WndProc trampoline');
  }
  classNameBuffer = wstr(WINDOW_CLASS_NAME);
  const hCursor = user32.symbols.LoadCursorW(0n, BigInt(IDC_ARROW));

  const wc = new Uint8Array(WNDCLASSEXW_SIZE);
  const dv = new DataView(wc.buffer);
  dv.setUint32(0, WNDCLASSEXW_SIZE, true); // cbSize
  dv.setUint32(4, CS_HREDRAW | CS_VREDRAW, true); // style
  dv.setBigUint64(8, BigInt(procPtr), true); // lpfnWndProc
  dv.setBigUint64(24, hInstance, true); // hInstance
  dv.setBigUint64(40, hCursor, true); // hCursor
  dv.setBigUint64(64, BigInt(ptr(classNameBuffer)), true); // lpszClassName
  // hIcon, cbClsExtra/cbWndExtra, hbrBackground, lpszMenuName, hIconSm left 0.

  if (user32.symbols.RegisterClassExW(ptr(wc)) === 0) {
    throw new FFIError('RegisterClassExW failed for the Bunmaska window class');
  }
  classRegistered = true;
  return hInstance;
};

/** Win32 window-style word for the framed/resizable options. */
const computeStyle = (frame: boolean | undefined, resizable: boolean | undefined): number => {
  let style = WS_CLIPCHILDREN; // never paint over the child web view
  if (frame === false) {
    style |= WS_POPUP;
  } else {
    style |= WS_OVERLAPPEDWINDOW;
    if (resizable === false) {
      style &= ~(WS_THICKFRAME | WS_MAXIMIZEBOX);
    }
  }
  return style >>> 0; // CreateWindowExW wants an unsigned 32-bit style
};

/** Options for constructing a {@link Win32Window}. */
export interface Win32WindowOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly show: boolean;
  readonly resizable?: boolean;
  readonly frame?: boolean;
}

/** A live top-level Win32 window identified by its HWND. */
export class Win32Window {
  readonly #hwnd: bigint;
  readonly #handlers: Win32WindowHandlers = { closed: false };
  #destroyed = false;

  constructor(options: Win32WindowOptions) {
    const hInstance = ensureWindowClass();
    const className = classNameBuffer;
    if (className === undefined) {
      throw new FFIError('window class buffer was not initialised');
    }
    const user32 = loadUser32();
    const titleBuffer = wstr(options.title);
    // Phase 1: width/height are taken as the window size. Client-vs-window sizing
    // (AdjustWindowRectEx) is refined when the seam's setSize lands.
    const hwnd = user32.symbols.CreateWindowExW(
      0,
      ptr(className),
      ptr(titleBuffer),
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

  onResize(callback: () => void): void {
    this.#handlers.onResize = callback;
  }

  onFocus(callback: () => void): void {
    this.#handlers.onFocus = callback;
  }

  onBlur(callback: () => void): void {
    this.#handlers.onBlur = callback;
  }

  setTitle(title: string): void {
    loadUser32().symbols.SetWindowTextW(this.#hwnd, ptr(wstr(title)));
  }

  /** The content (client) area size in physical pixels. */
  getClientSize(): { width: number; height: number } {
    const rect = new Uint8Array(RECT_SIZE);
    loadUser32().symbols.GetClientRect(this.#hwnd, ptr(rect));
    const dv = new DataView(rect.buffer);
    const right = dv.getInt32(8, true);
    const bottom = dv.getInt32(12, true);
    return { width: right, height: bottom }; // left/top of a client rect are always 0
  }

  show(): void {
    const user32 = loadUser32().symbols;
    user32.ShowWindow(this.#hwnd, SW_SHOW);
    // The process's FIRST ShowWindow is overridden by the launcher's
    // STARTUPINFO.wShowWindow when STARTF_USESHOWWINDOW is set — e.g. a window
    // spawned as a hidden child process stays hidden. A second call always
    // honors SW_SHOW, so re-apply if the window did not actually become visible.
    if (user32.IsWindowVisible(this.#hwnd) === 0) {
      user32.ShowWindow(this.#hwnd, SW_SHOW);
    }
  }

  hide(): void {
    loadUser32().symbols.ShowWindow(this.#hwnd, SW_HIDE);
  }

  isVisible(): boolean {
    return loadUser32().symbols.IsWindowVisible(this.#hwnd) !== 0;
  }

  /** Preventable close: consults the veto, then destroys (mirrors the native path). */
  close(): void {
    if (this.#destroyed || this.#handlers.closed) {
      return;
    }
    if (this.#handlers.onClose?.() === true) {
      return;
    }
    this.destroy();
  }

  /** Force-close, bypassing the veto. Idempotent. Fires `onClosed` via `WM_DESTROY`. */
  destroy(): void {
    if (this.#destroyed || this.#handlers.closed) {
      return;
    }
    this.#destroyed = true;
    loadUser32().symbols.DestroyWindow(this.#hwnd);
  }
}
