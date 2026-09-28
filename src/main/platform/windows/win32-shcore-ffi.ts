import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { winLibraryAccessor } from './win32';

// GetDpiForMonitor is Windows 8.1+ (callers fall back to 1.0), and it reports 96 to a
// DPI-unaware process, so scaleFactor stays 1 until the process opts into DPI awareness.
const SHCORE_SYMBOLS = {
  // (HMONITOR, MONITOR_DPI_TYPE, UINT* dpiX, UINT* dpiY) -> HRESULT (0 = S_OK)
  GetDpiForMonitor: {
    args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
} as const;

export const MDT_EFFECTIVE_DPI = 0;

/** Open shcore.dll and return its DPI symbol table. Memoised; Windows-only. */
export const loadShcore = winLibraryAccessor('shcore', () => dlopen('shcore.dll', SHCORE_SYMBOLS));
