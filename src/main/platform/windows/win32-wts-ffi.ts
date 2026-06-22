import { dlopen, FFIType } from 'bun:ffi';
import { winLibraryAccessor } from './win32';

/**
 * wtsapi32.dll session-change notifications for `powerMonitor`'s lock/unlock
 * events. `WTSRegisterSessionNotification` makes a window receive
 * `WM_WTSSESSION_CHANGE` (with `WTS_SESSION_LOCK` / `WTS_SESSION_UNLOCK` in
 * `wParam`). Flat-C exports — no COM.
 */
const WTSAPI32_SYMBOLS = {
  // (HWND, DWORD dwFlags) -> BOOL — deliver WM_WTSSESSION_CHANGE to the window.
  WTSRegisterSessionNotification: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
  // (HWND) -> BOOL — stop delivering session-change notifications.
  WTSUnRegisterSessionNotification: { args: [FFIType.u64], returns: FFIType.i32 },
} as const;

/** `NOTIFY_FOR_THIS_SESSION` — only this session's lock/unlock events. */
export const NOTIFY_FOR_THIS_SESSION = 0;

/** Open wtsapi32.dll and return its symbol table. Memoised; Windows-only. */
export const loadWtsapi32 = winLibraryAccessor('wtsapi32', () =>
  dlopen('wtsapi32.dll', WTSAPI32_SYMBOLS),
);
