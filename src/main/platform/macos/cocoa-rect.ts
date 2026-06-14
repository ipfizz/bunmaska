import { BunmaskaError } from '../../../common/errors';

/**
 * A Cocoa rectangle in user-space coordinates.
 *
 * Mirrors the C struct `CGRect = { CGPoint origin; CGSize size; }` where each
 * field is a `double`. Pure data — no FFI dependency.
 */
export type CGRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Size of a `CGRect` in bytes on macOS (4 × `double` = 32). */
export const CG_RECT_SIZE = 32;

/**
 * Pack a `CGRect` into a 32-byte `ArrayBuffer` with the layout Cocoa expects:
 * `[x, y, width, height]` as four contiguous little-endian f64s. macOS is
 * little-endian on both Intel and Apple Silicon, so endianness is hard-coded.
 */
export const packCGRect = (rect: CGRect): ArrayBuffer => {
  const buf = new ArrayBuffer(CG_RECT_SIZE);
  const view = new DataView(buf);
  view.setFloat64(0, rect.x, true);
  view.setFloat64(8, rect.y, true);
  view.setFloat64(16, rect.width, true);
  view.setFloat64(24, rect.height, true);
  return buf;
};

/**
 * Read a `CGRect` from a buffer laid out as `[x, y, width, height]` little-endian f64s.
 * Throws {@link BunmaskaError} when the buffer is shorter than {@link CG_RECT_SIZE}.
 */
export const unpackCGRect = (buffer: ArrayBufferLike): CGRect => {
  if (buffer.byteLength < CG_RECT_SIZE) {
    throw new BunmaskaError(
      `CGRect buffer must be at least ${CG_RECT_SIZE} bytes, got ${buffer.byteLength}`,
    );
  }
  const view = new DataView(buffer);
  return {
    x: view.getFloat64(0, true),
    y: view.getFloat64(8, true),
    width: view.getFloat64(16, true),
    height: view.getFloat64(24, true),
  };
};
