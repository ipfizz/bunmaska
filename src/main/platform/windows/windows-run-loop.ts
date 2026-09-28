import { ptr, read } from 'bun:ffi';
import { loadUser32 } from './win32-ffi';

// Never GetMessage or any blocking wait on the Bun thread (D019/D020/D043). The
// system's own modal loops (window move/size, menus) still stall Bun until they end.

const PM_REMOVE = 0x0001;

/**
 * `sizeof(MSG)` on LLP64: `HWND hwnd`(8) + `UINT message`(4) + padding(4) +
 * `WPARAM wParam`(8) + `LPARAM lParam`(8) + `DWORD time`(4) + `POINT pt`(8) +
 * `DWORD lPrivate`(4) = 48 bytes.
 */
const MSG_SIZE = 48;

/** Bounds one tick under a message flood so Bun's own loop is never starved. */
const DRAIN_BUDGET = 256;

/** Sees each posted message before dispatch; `true` means handled, so the drain skips it. */
export type MessageInspector = (hwnd: bigint, message: number, wParam: bigint) => boolean;

/** Build the per-tick drain for every window on this thread; the `MSG` buffer is reused. */
export const createWindowsDrain = (inspect?: MessageInspector): (() => void) => {
  const user32 = loadUser32();
  const msg = new Uint8Array(MSG_SIZE);
  const msgPtr = ptr(msg);
  return () => {
    let budget = DRAIN_BUDGET;
    while (budget > 0 && user32.symbols.PeekMessageW(msgPtr, 0n, 0, 0, PM_REMOVE) !== 0) {
      budget -= 1;
      if (inspect !== undefined) {
        // Never touch msg.buffer after ptr(msg): JSC moves the storage and msgPtr dangles.
        // MSG layout: hwnd@0 (u64), message@8 (u32), wParam@16 (u64).
        const hwnd = read.u64(msgPtr, 0);
        const message = read.u32(msgPtr, 8);
        const wParam = read.u64(msgPtr, 16);
        if (inspect(hwnd, message, wParam)) {
          continue;
        }
      }
      user32.symbols.TranslateMessage(msgPtr);
      user32.symbols.DispatchMessageW(msgPtr);
    }
  };
};
