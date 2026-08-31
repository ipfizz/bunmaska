import { dlopen, FFIType } from 'bun:ffi';
import { winLibraryAccessor } from './win32';

/**
 * shcore.dll per-monitor DPI for the screen backend. `GetDpiForMonitor` (Windows 8.1+)
 * yields a monitor's effective DPI, from which the device-pixel `scaleFactor` is
 * `dpi / 96`; shcore is absent before Windows 8.1, so callers fall back to a 1.0 scale.
 */
const SHCORE_SYMBOLS = {
  // (HMONITOR, MONITOR_DPI_TYPE, UINT* dpiX, UINT* dpiY) -> HRESULT (0 = S_OK)
  GetDpiForMonitor: {
    args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
} as const;

/** `MDT_EFFECTIVE_DPI` — the DPI used for layout scaling. */
export const MDT_EFFECTIVE_DPI = 0;

/** Open shcore.dll and return its DPI symbol table. Memoised; Windows-only. */
export const loadShcore = winLibraryAccessor('shcore', () => dlopen('shcore.dll', SHCORE_SYMBOLS));
