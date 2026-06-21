import { FFIType, JSCallback, ptr, read } from 'bun:ffi';
import type { Point, RawDisplay, ScreenBackend } from '../../api/screen';
import { loadUser32 } from './win32-ffi';
import { loadShcore, MDT_EFFECTIVE_DPI } from './win32-shcore-ffi';

/**
 * Windows display enumeration + cursor for the `screen` module, the WinCairo peer
 * of `cocoa-screen.ts` / `gdk-screen.ts`. `EnumDisplayMonitors` walks the monitors
 * (a short-lived, synchronous JSCallback collects the `HMONITOR`s — safe, unlike a
 * long-lived WndProc), `GetMonitorInfoW` reads each monitor's bounds + work area +
 * primary flag, and shcore's `GetDpiForMonitor` gives the device-pixel scale.
 * `rotation` (0) and `internal` (false) are not yet derived — a documented v1 gap.
 */

/** `sizeof(MONITORINFO)`: cbSize(4) + rcMonitor(16) + rcWork(16) + dwFlags(4). */
const MONITORINFO_SIZE = 40;
const RC_MONITOR_OFFSET = 4;
const RC_WORK_OFFSET = 20;
const DW_FLAGS_OFFSET = 36;
/** `MONITORINFOF_PRIMARY` — this monitor is the primary display. */
const MONITORINFOF_PRIMARY = 0x1;
/** `POINT` is two LONGs: x@0, y@4. */
const DEFAULT_DPI = 96;

/** Read a `RECT` (4 LONGs) at `offset` in a native MONITORINFO buffer as a {@link RawDisplay} rect. */
const readRect = (
  miPtr: ReturnType<typeof ptr>,
  offset: number,
): { x: number; y: number; width: number; height: number } => {
  const left = read.i32(miPtr, offset);
  const top = read.i32(miPtr, offset + 4);
  const right = read.i32(miPtr, offset + 8);
  const bottom = read.i32(miPtr, offset + 12);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** The device-pixel scale of a monitor (`dpi / 96`); best-effort, defaults to 1. */
const monitorScaleFactor = (hMonitor: bigint): number => {
  try {
    const dpiX = new Uint8Array(4);
    const dpiY = new Uint8Array(4);
    const dpiXPtr = ptr(dpiX);
    if (
      loadShcore().symbols.GetDpiForMonitor(hMonitor, MDT_EFFECTIVE_DPI, dpiXPtr, ptr(dpiY)) === 0
    ) {
      const dpi = read.u32(dpiXPtr, 0);
      return dpi > 0 ? dpi / DEFAULT_DPI : 1;
    }
  } catch {
    // shcore.dll absent (pre-Windows 8.1) — fall back to a 1.0 scale.
  }
  return 1;
};

/** Enumerate every monitor handle via a short-lived synchronous JSCallback. */
const enumerateMonitors = (): bigint[] => {
  const handles: bigint[] = [];
  const callback = new JSCallback(
    (hMonitor: bigint): number => {
      handles.push(hMonitor);
      return 1; // continue enumeration
    },
    { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.i64], returns: FFIType.i32 },
  );
  try {
    loadUser32().symbols.EnumDisplayMonitors(0n, null, callback.ptr, 0n);
  } finally {
    callback.close();
  }
  return handles;
};

/** Build a {@link RawDisplay} from one monitor handle. */
const describeMonitor = (hMonitor: bigint): RawDisplay => {
  const mi = new Uint8Array(MONITORINFO_SIZE);
  new DataView(mi.buffer).setUint32(0, MONITORINFO_SIZE, true); // cbSize
  const miPtr = ptr(mi);
  loadUser32().symbols.GetMonitorInfoW(hMonitor, miPtr);
  const flags = read.u32(miPtr, DW_FLAGS_OFFSET);
  return {
    // A stable per-session id derived from the monitor handle.
    id: Number(hMonitor & 0x7fffffffn),
    bounds: readRect(miPtr, RC_MONITOR_OFFSET),
    workArea: readRect(miPtr, RC_WORK_OFFSET),
    scaleFactor: monitorScaleFactor(hMonitor),
    rotation: 0,
    internal: false,
    primary: (flags & MONITORINFOF_PRIMARY) !== 0,
  };
};

export const windowsScreenBackend: ScreenBackend = {
  getDisplays(): readonly RawDisplay[] {
    return enumerateMonitors().map(describeMonitor);
  },

  getCursorScreenPoint(): Point {
    const point = new Uint8Array(8);
    const pointPtr = ptr(point);
    loadUser32().symbols.GetCursorPos(pointPtr);
    return { x: read.i32(pointPtr, 0), y: read.i32(pointPtr, 4) };
  },
};
