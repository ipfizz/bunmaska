import { FFIType, JSCallback, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { wstr } from './win32';
import { loadKernel32, loadUser32 } from './win32-ffi';

/**
 * A hidden, non-WebKit Win32 window that receives system notifications
 * (`WM_POWERBROADCAST`, `WM_WTSSESSION_CHANGE`, a tray icon's callback) for the
 * backends that need a window-procedure but must NOT touch WebKit.
 *
 * The WebKit-hosting window deliberately uses the system `DefWindowProc` (a
 * JSCallback WndProc there crashes under WebKit's re-entrant message flood — see
 * `windows-native-window.ts`). THIS window hosts no WebKit, so a JSCallback WndProc
 * is safe: it receives only the low-frequency system messages above. One class +
 * one shared WndProc dispatches to per-window handlers keyed by `HWND`; the
 * callback is retained for process life. The cooperative pump (`PeekMessage` /
 * `DispatchMessage`) delivers messages here like any other window.
 */

const WNDCLASSEXW_SIZE = 80;
const CLASS_NAME = 'BunmaskaMessageWindow';
/** `WS_EX_TOOLWINDOW` — keep the (never-shown) window out of the taskbar/alt-tab. */
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_OVERLAPPED = 0x00000000;

/** A per-window message observer: a posted/sent message and its parameters. */
export type MessageHandler = (message: number, wParam: bigint, lParam: bigint) => void;

/** A live hidden window: its handle and a teardown that unregisters + destroys it. */
export type MessageWindow = {
  readonly hwnd: bigint;
  readonly destroy: () => void;
};

const handlersByHwnd = new Map<bigint, MessageHandler>();

/** Lazily-created shared state: the registered class + the retained WndProc. */
let registered: { readonly wndProc: JSCallback } | undefined;

/** Register the window class once, wiring the shared dispatching WndProc. */
const ensureClassRegistered = (): void => {
  if (registered !== undefined) {
    return;
  }
  const user32 = loadUser32().symbols;
  const wndProc = new JSCallback(
    (hwnd: bigint, message: number, wParam: bigint, lParam: bigint): bigint => {
      const handler = handlersByHwnd.get(hwnd);
      if (handler !== undefined) {
        try {
          handler(message, wParam, lParam);
        } catch {
          // A throwing JS handler must never propagate into the native WndProc.
        }
      }
      return user32.DefWindowProcW(hwnd, message, wParam, lParam);
    },
    { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
  );
  const wndProcPtr = wndProc.ptr;
  if (wndProcPtr === null) {
    throw new FFIError('message window: failed to allocate the WndProc trampoline');
  }

  const hInstance = loadKernel32().symbols.GetModuleHandleW(null);
  const className = wstr(CLASS_NAME);
  const wc = new Uint8Array(WNDCLASSEXW_SIZE);
  const view = new DataView(wc.buffer);
  view.setUint32(0, WNDCLASSEXW_SIZE, true); // cbSize
  view.setBigUint64(8, BigInt(wndProcPtr), true); // lpfnWndProc
  view.setBigUint64(24, hInstance, true); // hInstance
  view.setBigUint64(64, BigInt(ptr(className)), true); // lpszClassName
  user32.RegisterClassExW(ptr(wc));
  // Retain the JSCallback for the whole process (the class references it forever).
  registered = { wndProc };
};

/**
 * Create a hidden top-level window whose messages are delivered to `handler`.
 * Top-level (not message-only) so it receives broadcast `WM_POWERBROADCAST`; the
 * `WS_EX_TOOLWINDOW` style keeps it invisible to the user. The window is never
 * shown.
 */
export const createMessageWindow = (handler: MessageHandler): MessageWindow => {
  ensureClassRegistered();
  const user32 = loadUser32().symbols;
  const hInstance = loadKernel32().symbols.GetModuleHandleW(null);
  const className = wstr(CLASS_NAME);
  const hwnd = user32.CreateWindowExW(
    WS_EX_TOOLWINDOW,
    ptr(className),
    null,
    WS_OVERLAPPED,
    0,
    0,
    0,
    0,
    0n, // no parent — a (hidden) top-level window receives WM_POWERBROADCAST
    0n,
    hInstance,
    null,
  );
  handlersByHwnd.set(hwnd, handler);
  return {
    hwnd,
    destroy: (): void => {
      handlersByHwnd.delete(hwnd);
      user32.DestroyWindow(hwnd);
    },
  };
};
