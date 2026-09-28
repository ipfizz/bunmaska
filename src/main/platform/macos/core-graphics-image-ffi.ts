import { FFIType, type Pointer } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { cgRectArgs, RECT_F64 } from './cocoa-msgsend-variants';
import { macOSLibraryAccessor } from './objc';

/**
 * Offscreen CoreGraphics bitmap symbols behind macOS `nativeImage` resize/crop: no window
 * server, so they work headless. Nothing returns a struct (D030).
 */

const CORE_GRAPHICS_PATH = '/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics';

/** `kCGImageAlphaPremultipliedLast`: RGBA, the standard CG drawing format. */
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
  // (ctx, CGRect BY VALUE (D018), image) -> void; called through the wrapper below.
  CGContextDrawImage: {
    args: [FFIType.pointer, ...RECT_F64, FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

export const loadCoreGraphicsImageFFI = macOSLibraryAccessor('CoreGraphics nativeImage', () => {
  const { symbols } = dlopen(CORE_GRAPHICS_PATH, CORE_GRAPHICS_SYMBOLS);
  const draw = symbols.CGContextDrawImage;
  return {
    symbols: {
      ...symbols,
      CGContextDrawImage: (
        ctx: Pointer | null,
        x: number,
        y: number,
        width: number,
        height: number,
        image: Pointer | null,
      ): void => draw(ctx, ...cgRectArgs([x, y, width, height]), image),
    },
  };
});
