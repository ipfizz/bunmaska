import { dlopen, FFIType } from 'bun:ffi';
import { macOSLibraryAccessor } from './objc';

/**
 * CoreGraphics bitmap-context symbols behind macOS `nativeImage` resize/crop.
 *
 * The resize/crop redraw goes through an OFFSCREEN bitmap context
 * (`CGBitmapContextCreate(NULL, …)`) — a malloc-backed buffer with NO window
 * server, so it works headless (no `NSApplication`, no `lockFocus`). The source
 * `CGImageRef` comes from the rep's `[rep CGImage]`; the redrawn `CGImageRef` is
 * wrapped back into an `NSBitmapImageRep` via `initWithCGImage:`.
 *
 * Everything here is an opaque pointer (CGContextRef/CGImageRef/CGColorSpaceRef)
 * — no struct is ever returned (D30). The one struct ARG, the `CGRect` passed to
 * `CGContextDrawImage`, is supplied as four `double`s (D018 struct-as-doubles);
 * on arm64 a 4-double homogeneous-FP struct occupies d0–d3 identically.
 */

const CORE_GRAPHICS_PATH = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics';

/** `kCGImageAlphaPremultipliedLast` — RGBA, the standard CG drawing format. */
export const KCG_ALPHA_PREMULTIPLIED_LAST = 1;

const CORE_GRAPHICS_SYMBOLS = {
  // (data /*NULL → CG owns the buffer*/, w, h, bitsPerComponent, bytesPerRow /*0 → CG picks*/,
  //  colorSpace, bitmapInfo) -> CGContextRef (NULL on failure).
  CGBitmapContextCreate: {
    args: [
      FFIType.pointer,
      FFIType.u64,
      FFIType.u64,
      FFIType.u64,
      FFIType.u64,
      FFIType.pointer,
      FFIType.u32,
    ],
    returns: FFIType.pointer,
  },
  CGBitmapContextCreateImage: { args: [FFIType.pointer], returns: FFIType.pointer },
  CGColorSpaceCreateDeviceRGB: { args: [], returns: FFIType.pointer },
  CGColorSpaceRelease: { args: [FFIType.pointer], returns: FFIType.void },
  CGContextRelease: { args: [FFIType.pointer], returns: FFIType.void },
  CGImageRelease: { args: [FFIType.pointer], returns: FFIType.void },
  // (ctx, CGRect{x,y,w,h} BY VALUE as 4 doubles (D018), image) -> void.
  CGContextDrawImage: {
    args: [FFIType.pointer, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

/** Open CoreGraphics and expose the offscreen-bitmap symbols (memoised; macOS-only). */
export const loadCoreGraphicsImageFFI = macOSLibraryAccessor('CoreGraphics nativeImage', () =>
  dlopen(CORE_GRAPHICS_PATH, CORE_GRAPHICS_SYMBOLS),
);
