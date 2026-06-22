import { ptr, read } from 'bun:ffi';
import { loadUser32 } from './win32-ffi';

/**
 * Windows drain for the shared {@link CooperativePump} (mirrors
 * `macos/cocoa-run-loop.ts` and `linux/gtk-run-loop.ts`).
 *
 * Each tick removes and dispatches up to {@link DRAIN_BUDGET} queued messages
 * with a NON-BLOCKING `PeekMessage`/`TranslateMessage`/`DispatchMessage` loop.
 * It must NEVER call `GetMessage` (which blocks until a message arrives) nor a
 * web engine's own modal message loop — blocking the thread Bun owns crashes Bun
 * (D019/D020). The per-tick budget bounds how long one drain can run so it can't
 * starve Bun's own event loop under a message flood.
 */

/** `PeekMessage` removal flag: pull the message out of the queue. */
const PM_REMOVE = 0x0001;

/**
 * `sizeof(MSG)` on x64: `HWND hwnd`(8) + `UINT message`(4) + padding(4) +
 * `WPARAM wParam`(8) + `LPARAM lParam`(8) + `DWORD time`(4) + `POINT pt`(8) +
 * `DWORD lPrivate`(4) = 48 bytes.
 */
const MSG_SIZE = 48;

/** Max messages dispatched per tick before yielding back to Bun's loop. */
const DRAIN_BUDGET = 256;

/**
 * Inspect a posted message before it is dispatched. Returns `true` when the
 * message was fully handled (the drain then SKIPS the default dispatch). This is
 * how the Windows backend routes window lifecycle (e.g. the preventable close)
 * without a JSCallback WndProc — see `windows-native-window.ts`.
 */
export type MessageInspector = (hwnd: bigint, message: number, wParam: bigint) => boolean;

/**
 * Build the non-blocking Windows drain. The `MSG` buffer is allocated once and
 * reused across ticks; `PeekMessage(hwnd=NULL)` services every window on the
 * calling (Bun main) thread. An optional {@link MessageInspector} gets first look
 * at each message (for backend lifecycle routing) and can swallow it.
 */
export const createWindowsDrain = (inspect?: MessageInspector): (() => void) => {
  const user32 = loadUser32();
  const msg = new Uint8Array(MSG_SIZE);
  const msgPtr = ptr(msg);
  return () => {
    let budget = DRAIN_BUDGET;
    while (budget > 0 && user32.symbols.PeekMessageW(msgPtr, 0n, 0, 0, PM_REMOVE) !== 0) {
      budget -= 1;
      if (inspect !== undefined) {
        // Read the MSG fields from the POINTER, not the backing Uint8Array: bun's
        // `ptr()` hands FFI a buffer that the JS array does not reflect for native
        // writes, so PeekMessage's output is only visible via `read.*` on msgPtr.
        // MSG layout (x64): hwnd@0 (u64), message@8 (u32), wParam@16 (u64).
        const hwnd = read.u64(msgPtr, 0);
        const message = read.u32(msgPtr, 8);
        const wParam = read.u64(msgPtr, 16);
        if (inspect(hwnd, message, wParam)) {
          continue; // handled by the backend — skip default dispatch
        }
      }
      user32.symbols.TranslateMessage(msgPtr);
      user32.symbols.DispatchMessageW(msgPtr);
    }
  };
};
