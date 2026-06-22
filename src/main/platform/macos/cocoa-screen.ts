import { dlopen, FFIType, ptr } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import type { Point, RawDisplay, ScreenBackend } from '../../api/screen';

/**
 * macOS display enumeration via CoreGraphics scalar getters.
 *
 * WHY NOT NSScreen.frame / CGDisplayBounds (the struct-return path): bun:ffi
 * 1.3.14 has no struct return type — `FFIType` exposes no `struct` member and
 * `dlopen` rejects both an array layout (`[f64,f64,f64,f64]`) and an object
 * layout as a `returns` type ("Unknown return type"). On arm64 a CGRect/NSRect
 * is a homogeneous-float aggregate returned in v0..v3; declaring the call as
 * `returns: f64` recovers ONLY the first field (origin.x). The remaining three
 * doubles (y/width/height) are unreachable without struct support, and the
 * inline C compiler (`cc`) is off-limits (zero-compiled-native-code rule). So
 * the geometry comes entirely from CoreGraphics scalar getters, which were
 * empirically verified on a real arm64 host to return sane values.
 *
 * Fields populated: id (CGDirectDisplayID), bounds size (CGDisplayPixelsWide/
 * High — logical points), scaleFactor (display-mode pixel/logical width),
 * rotation (CGDisplayRotation), internal (CGDisplayIsBuiltin), primary
 * (CGDisplayIsMain).
 *
 * v1 LIMITATION — display ORIGIN (bounds.x/y): CoreGraphics has no scalar
 * getter for a display's global origin; only the struct-return CGDisplayBounds
 * exposes it. The primary display's origin is (0,0) by definition, so single-
 * display and primary geometry are exact. For SECONDARY displays the origin is
 * reported as (0,0) too (documented), which makes multi-monitor bounds.x/y and
 * cross-display nearest-point placement approximate until struct return lands.
 * workArea == bounds on macOS v1 (the menu-bar/dock inset needs NSScreen
 * visibleFrame, another struct return), documented.
 */

const CG_PATH = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics';

const CG_SYMBOLS = {
  CGGetActiveDisplayList: {
    args: [FFIType.u32, FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  CGMainDisplayID: { args: [], returns: FFIType.u32 },
  CGDisplayPixelsWide: { args: [FFIType.u32], returns: FFIType.u64 },
  CGDisplayPixelsHigh: { args: [FFIType.u32], returns: FFIType.u64 },
  CGDisplayRotation: { args: [FFIType.u32], returns: FFIType.f64 },
  CGDisplayIsBuiltin: { args: [FFIType.u32], returns: FFIType.u32 },
  CGDisplayIsMain: { args: [FFIType.u32], returns: FFIType.u32 },
  CGDisplayCopyDisplayMode: { args: [FFIType.u32], returns: FFIType.pointer },
  CGDisplayModeGetWidth: { args: [FFIType.pointer], returns: FFIType.u64 },
  CGDisplayModeGetPixelWidth: { args: [FFIType.pointer], returns: FFIType.u64 },
  CGDisplayModeRelease: { args: [FFIType.pointer], returns: FFIType.void },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof CG_SYMBOLS>> | undefined } = { ffi: undefined };

/**
 * Open CoreGraphics and expose the display scalar getters. Only callable on
 * macOS — throws {@link UnsupportedPlatformError} elsewhere so the module stays
 * importable on Linux for unit testing.
 */
export const loadCoreGraphicsFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'macos') {
    throw new UnsupportedPlatformError(
      `loadCoreGraphicsFFI() is only supported on macOS; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(CG_PATH, CG_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

const MAX_DISPLAYS = 32;

/** scaleFactor = physical / logical width of the display's current mode (>= 1). */
const scaleFactorFor = (
  symbols: ReturnType<typeof loadCoreGraphicsFFI>['symbols'],
  id: number,
): number => {
  const mode = symbols.CGDisplayCopyDisplayMode(id);
  if (mode === null) {
    return 1;
  }
  const logical = Number(symbols.CGDisplayModeGetWidth(mode));
  const physical = Number(symbols.CGDisplayModeGetPixelWidth(mode));
  symbols.CGDisplayModeRelease(mode);
  return logical > 0 ? physical / logical : 1;
};

const rawDisplayFor = (
  symbols: ReturnType<typeof loadCoreGraphicsFFI>['symbols'],
  id: number,
): RawDisplay => {
  const width = Number(symbols.CGDisplayPixelsWide(id));
  const height = Number(symbols.CGDisplayPixelsHigh(id));
  // Origin x/y has no scalar getter; (0,0) is exact for the primary display and
  // a documented v1 approximation for secondary displays. See module header.
  const bounds = { x: 0, y: 0, width, height };
  return {
    id,
    bounds,
    workArea: bounds,
    scaleFactor: scaleFactorFor(symbols, id),
    rotation: symbols.CGDisplayRotation(id),
    internal: symbols.CGDisplayIsBuiltin(id) === 1,
    primary: symbols.CGDisplayIsMain(id) === 1,
  };
};

/** Enumerate the active displays via CoreGraphics scalar getters. */
export const getDisplays = (): readonly RawDisplay[] => {
  const { symbols } = loadCoreGraphicsFFI();
  const ids = new Uint32Array(MAX_DISPLAYS);
  const count = new Uint32Array(1);
  const err = symbols.CGGetActiveDisplayList(MAX_DISPLAYS, ptr(ids), ptr(count));
  const found = count[0] ?? 0;
  if (err !== 0 || found === 0) {
    // Fall back to the main display so callers always get at least one entry.
    return [rawDisplayFor(symbols, symbols.CGMainDisplayID())];
  }
  const displays: RawDisplay[] = [];
  for (let i = 0; i < found; i++) {
    displays.push(rawDisplayFor(symbols, ids[i] ?? 0));
  }
  return displays;
};

/**
 * Cursor position. NSEvent.mouseLocation returns an NSPoint (2-f64 struct) —
 * the same struct-return wall as the frame rects — so v1 returns {0,0}. The
 * bottom-left-origin flip would also be needed even if the struct were
 * readable, so this is deferred behind the struct-return work. Documented.
 */
export const getCursorScreenPoint = (): Point => ({ x: 0, y: 0 });

/** The macOS screen backend the public `screen` API delegates to. */
export const cocoaScreenBackend: ScreenBackend = {
  getDisplays,
  getCursorScreenPoint,
};
