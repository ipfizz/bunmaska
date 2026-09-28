import { FFIType, JSCallback, ptr } from 'bun:ffi';
import { FFIError } from '../../../common/errors';
import { reportCallbackError } from '../../../common/report-error';
import { registerWindowClass, wstr } from './win32';
import { loadKernel32, loadUser32 } from './win32-ffi';

// Hidden windows for system notifications (power, session, tray). They host no WebKit,
// so a JSCallback WndProc is safe here (D043).

const CLASS_NAME = 'BunmaskaMessageWindow';
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_OVERLAPPED = 0x00000000;
const WM_CLOSE = 0x0010;

/** A per-window message observer: a posted/sent message and its parameters. */
export type MessageHandler = (message: number, wParam: bigint, lParam: bigint) => void;

/** A live hidden window: its handle and a teardown that unregisters + destroys it. */
export type MessageWindow = {
  readonly hwnd: bigint;
  readonly destroy: () => void;
};

const handlersByHwnd = new Map<bigint, MessageHandler>();

// Retained for the process: the registered class calls this proc until exit.
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
        } catch (error) {
          // Same rule as the frame proc: never propagate into native code.
          reportCallbackError(error);
        }
      }
      // An external WM_CLOSE must not destroy it; only destroy() does.
      return message === WM_CLOSE ? 0n : user32.DefWindowProcW(hwnd, message, wParam, lParam);
    },
    { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i64 },
  );
  const wndProcPtr = wndProc.ptr;
  if (wndProcPtr === null) {
    throw new FFIError('message window: failed to allocate the WndProc trampoline');
  }

  const hInstance = loadKernel32().symbols.GetModuleHandleW(null);
  registerWindowClass(user32, CLASS_NAME, BigInt(wndProcPtr), hInstance);
  registered = { wndProc };
};

/** A never-shown top-level window feeding `handler`; not message-only, so it gets broadcasts. */
export const createMessageWindow = (handler: MessageHandler): MessageWindow => {
  ensureClassRegistered();
  const user32 = loadUser32().symbols;
  const hInstance = loadKernel32().symbols.GetModuleHandleW(null);
  const hwnd = user32.CreateWindowExW(
    WS_EX_TOOLWINDOW,
    ptr(wstr(CLASS_NAME)),
    null,
    WS_OVERLAPPED,
    0,
    0,
    0,
    0,
    0n,
    0n,
    hInstance,
    null,
  );
  if (hwnd === 0n) {
    throw new FFIError('CreateWindowExW returned NULL for the message window');
  }
  handlersByHwnd.set(hwnd, handler);
  let destroyed = false;
  return {
    hwnd,
    destroy: (): void => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      handlersByHwnd.delete(hwnd);
      user32.DestroyWindow(hwnd);
    },
  };
};
