import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { winLibraryAccessor } from './win32';

const WTSAPI32_SYMBOLS = {
  // (HWND, DWORD dwFlags) -> BOOL: deliver WM_WTSSESSION_CHANGE to the window
  WTSRegisterSessionNotification: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
} as const;

export const NOTIFY_FOR_THIS_SESSION = 0;

/** Open wtsapi32.dll and return its symbol table. Memoised; Windows-only. */
export const loadWtsapi32 = winLibraryAccessor('wtsapi32', () =>
  dlopen('wtsapi32.dll', WTSAPI32_SYMBOLS),
);
