import { ptr, toArrayBuffer } from 'bun:ffi';
import type { DecodedImage, NativeImageBackend, NativeImageHandle } from '../../api/native-image';
import { nsString } from './cocoa-foundation';
import {
  msgSendF64,
  msgSendI64Ptr,
  msgSendPtr,
  msgSendPtrI64,
  msgSendPtrPtr,
  msgSendReturnsI64,
} from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { KCG_ALPHA_PREMULTIPLIED_LAST, loadCoreGraphicsImageFFI } from './core-graphics-image-ffi';
import { type Handle, ptrIn } from './objc';

/**
 * macOS image backend for `nativeImage`, via `NSBitmapImageRep` / `NSData`.
 *
 * DECODE: we build an `NSBitmapImageRep` DIRECTLY from the file/data
 * (`[[NSBitmapImageRep alloc] initWithData:]`) rather than going through
 * `NSImage`. The rep is the unit that exposes both the scalar pixel dimensions
 * and the PNG encoder, so a single object covers `getSize` and `toPNG`.
 *
 * SIZE WITHOUT A STRUCT — `NSImage.size` returns an `NSSize` (a struct of two
 * doubles) by value, which bun:ffi CANNOT return. `NSBitmapImageRep`'s
 * `pixelsWide` / `pixelsHigh` are `NSInteger` SCALARS instead, read here via the
 * `i64`-returning msgSend variant. This is the entire reason we decode straight
 * to a rep: no struct ever crosses the FFI boundary for sizing.
 *
 * BUFFER DECODE — `[[NSData alloc] initWithBytes:length:]` COPIES the source
 * bytes, so the pinned `Uint8Array` need only outlive that one call.
 *
 * ENCODE — `[rep representationUsingType:(NSBitmapImageFileTypePNG = 4)
 * properties:nil]` returns an `NSData`; we read its `bytes` pointer (scalar) and
 * `length` (NSUInteger scalar) and copy them out with `toArrayBuffer`.
 *
 * EMPTY — a nil rep (bad path / undecodable bytes) is reported as empty with a
 * `0n` handle and zero dimensions; no fake placeholder image is fabricated.
 */

/** `NSBitmapImageFileType` values. */
const NS_BITMAP_IMAGE_FILE_TYPE_PNG = 4n;
const NS_BITMAP_IMAGE_FILE_TYPE_JPEG = 3n;

const EMPTY: DecodedImage = { handle: 0n, width: 0, height: 0, empty: true };

/** Copy an `NSData`'s bytes out into an owned `Uint8Array` (empty when nil/empty). */
export const nsDataToBytes = (data: Handle): Uint8Array => {
  if (data === 0n) {
    return new Uint8Array(0);
  }
  const rt = cocoa();
  const length = Number(msgSendReturnsI64(data, rt.selectors.get('length')));
  if (length <= 0) {
    return new Uint8Array(0);
  }
  const bytesPtr = rt.msgSend(data, rt.selectors.get('bytes'));
  if (bytesPtr === 0n) {
    return new Uint8Array(0);
  }
  // Copy out of the autoreleased NSData-owned buffer so the result owns its bytes.
  return new Uint8Array(toArrayBuffer(ptrIn(bytesPtr), 0, length).slice(0));
};

/** `[[NSData alloc] initWithBytes:length:]` from a Uint8Array (copies the bytes). */
export const nsDataFromBytes = (bytes: Uint8Array): Handle => {
  const rt = cocoa();
  const alloc = rt.msgSend(rt.classes.get('NSData'), rt.selectors.get('alloc'));
  const dataPtr = bytes.length === 0 ? 0n : BigInt(ptr(bytes));
  return msgSendPtrI64(
    alloc,
    rt.selectors.get('initWithBytes:length:'),
    dataPtr,
    BigInt(bytes.length),
  );
};

/** `[[NSBitmapImageRep alloc] initWithData:]` — nil on undecodable data. */
const bitmapRepFromData = (data: Handle): Handle => {
  if (data === 0n) {
    return 0n;
  }
  const rt = cocoa();
  const alloc = rt.msgSend(rt.classes.get('NSBitmapImageRep'), rt.selectors.get('alloc'));
  return msgSendPtr(alloc, rt.selectors.get('initWithData:'), data);
};

/** Build a decoded-image record from a (possibly nil) `NSBitmapImageRep`. */
const decodeFromRep = (rep: Handle): DecodedImage => {
  if (rep === 0n) {
    return EMPTY;
  }
  const rt = cocoa();
  const width = Number(msgSendReturnsI64(rep, rt.selectors.get('pixelsWide')));
  const height = Number(msgSendReturnsI64(rep, rt.selectors.get('pixelsHigh')));
  if (width <= 0 || height <= 0) {
    return EMPTY;
  }
  return { handle: rep, width, height, empty: false };
};

const decodePath = (path: string): DecodedImage => {
  const rt = cocoa();
  // [NSData dataWithContentsOfFile:] is nil for a bad/unreadable path.
  const data = msgSendPtr(
    rt.classes.get('NSData'),
    rt.selectors.get('dataWithContentsOfFile:'),
    nsString(path),
  );
  return decodeFromRep(bitmapRepFromData(data));
};

const decodeBuffer = (bytes: Uint8Array): DecodedImage =>
  decodeFromRep(bitmapRepFromData(nsDataFromBytes(bytes)));

/**
 * Redraw a rep's `CGImage` into a NEW `width`×`height` offscreen bitmap, placing the source
 * at dest rect `(dx,dy,dw,dh)`, and wrap the result as an `NSBitmapImageRep`. Headless (a
 * malloc-backed CG bitmap context — no window server). The source `[rep CGImage]` is BORROWED
 * (not released); the new rep is leaked for the image's lifetime (matching decode); the CG
 * context / color space / output CGImage temporaries ARE released.
 */
const redraw = (
  handle: NativeImageHandle,
  width: number,
  height: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): DecodedImage => {
  if (handle === 0n) {
    return EMPTY;
  }
  const rt = cocoa();
  const cg = loadCoreGraphicsImageFFI().symbols;
  const srcImage = rt.msgSend(handle, rt.selectors.get('CGImage')); // borrowed
  if (srcImage === 0n) {
    return EMPTY;
  }
  const colorSpace = cg.CGColorSpaceCreateDeviceRGB();
  if (colorSpace === null) {
    return EMPTY;
  }
  const ctx = cg.CGBitmapContextCreate(
    null,
    BigInt(width),
    BigInt(height),
    8n,
    0n,
    colorSpace,
    KCG_ALPHA_PREMULTIPLIED_LAST,
  );
  if (ctx === null) {
    cg.CGColorSpaceRelease(colorSpace);
    return EMPTY;
  }
  cg.CGContextDrawImage(ctx, dx, dy, dw, dh, ptrIn(srcImage));
  const outImage = cg.CGBitmapContextCreateImage(ctx);
  cg.CGContextRelease(ctx);
  cg.CGColorSpaceRelease(colorSpace);
  if (outImage === null) {
    return EMPTY;
  }
  const alloc = rt.msgSend(rt.classes.get('NSBitmapImageRep'), rt.selectors.get('alloc'));
  const rep = msgSendPtr(alloc, rt.selectors.get('initWithCGImage:'), BigInt(outImage));
  cg.CGImageRelease(outImage); // initWithCGImage: copies the pixels into the rep.
  return decodeFromRep(rep);
};

const resize = (handle: NativeImageHandle, width: number, height: number): DecodedImage =>
  redraw(handle, width, height, 0, 0, width, height); // scale the whole source to fill the target

const crop = (
  handle: NativeImageHandle,
  x: number,
  y: number,
  width: number,
  height: number,
): DecodedImage => {
  const rt = cocoa();
  const srcW = Number(msgSendReturnsI64(handle, rt.selectors.get('pixelsWide')));
  const srcH = Number(msgSendReturnsI64(handle, rt.selectors.get('pixelsHigh')));
  // Draw the full source at native size into the crop-sized context, offset so the top-left
  // crop window lands at the dest origin. CG uses a BOTTOM-left origin, so y flips:
  //   top-left (x, y) → CG dest origin (-x, -(srcH - y - height)).
  return redraw(handle, width, height, -x, -(srcH - y - height), srcW, srcH);
};

/** macOS implementation of {@link NativeImageBackend}. */
export const cocoaNativeImageBackend: NativeImageBackend = {
  decode: (source) => (typeof source === 'string' ? decodePath(source) : decodeBuffer(source)),
  encodePng: (handle: NativeImageHandle): Uint8Array => {
    if (handle === 0n) {
      return new Uint8Array(0);
    }
    const rt = cocoa();
    const data = msgSendI64Ptr(
      handle,
      rt.selectors.get('representationUsingType:properties:'),
      NS_BITMAP_IMAGE_FILE_TYPE_PNG,
      0n,
    );
    return nsDataToBytes(data);
  },
  encodeJpeg: (handle: NativeImageHandle, quality: number): Uint8Array => {
    if (handle === 0n) {
      return new Uint8Array(0);
    }
    const rt = cocoa();
    // Properties dict { NSImageCompressionFactor: quality/100 } (0.0–1.0).
    const factor = Math.max(0, Math.min(100, quality)) / 100;
    const number = msgSendF64(
      rt.classes.get('NSNumber'),
      rt.selectors.get('numberWithDouble:'),
      factor,
    );
    const properties = msgSendPtrPtr(
      rt.classes.get('NSDictionary'),
      rt.selectors.get('dictionaryWithObject:forKey:'),
      number,
      nsString('NSImageCompressionFactor'),
    );
    const data = msgSendI64Ptr(
      handle,
      rt.selectors.get('representationUsingType:properties:'),
      NS_BITMAP_IMAGE_FILE_TYPE_JPEG,
      properties,
    );
    return nsDataToBytes(data);
  },
  resize,
  crop,
};
