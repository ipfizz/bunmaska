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

// Decode straight to an NSBitmapImageRep, never NSImage: NSImage.size is an NSSize struct that
// bun:ffi cannot return, while the rep's pixelsWide/pixelsHigh are scalars.

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
  // Copy: the bytes belong to the NSData, which the caller may free right after.
  return new Uint8Array(toArrayBuffer(ptrIn(bytesPtr), 0, length).slice(0));
};

/** `[[NSData alloc] initWithBytes:length:]` (+1): it copies, so `bytes` need only outlive the call. */
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

/** `[[NSBitmapImageRep alloc] initWithData:]` (+1); nil on undecodable data. */
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
  const data = msgSendPtr(
    rt.classes.get('NSData'),
    rt.selectors.get('dataWithContentsOfFile:'),
    nsString(path),
  );
  return decodeFromRep(bitmapRepFromData(data));
};

const decodeBuffer = (bytes: Uint8Array): DecodedImage => {
  const data = nsDataFromBytes(bytes);
  const rep = bitmapRepFromData(data);
  cocoa().msgSend(data, cocoa().selectors.get('release')); // the rep keeps what it needs
  return decodeFromRep(rep);
};

/**
 * Draw a rep's CGImage at dest rect (dx, dy, dw, dh) of a new width x height bitmap (headless,
 * no window server). `[rep CGImage]` is borrowed; the caller owns the returned +1 rep.
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
  cg.CGImageRelease(outImage); // the rep retains outImage; drop our +1
  return decodeFromRep(rep);
};

const resize = (handle: NativeImageHandle, width: number, height: number): DecodedImage =>
  redraw(handle, width, height, 0, 0, width, height);

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
  // CG's origin is bottom-left: top-left crop (x, y) is dest origin (-x, -(srcH - y - height)).
  return redraw(handle, width, height, -x, -(srcH - y - height), srcW, srcH);
};

/** `representationUsingType:properties:` bytes; empty for a nil handle or a failed encode. */
const encode = (handle: NativeImageHandle, type: bigint, properties: Handle): Uint8Array => {
  if (handle === 0n) {
    return new Uint8Array(0);
  }
  const rt = cocoa();
  const represent = (rep: Handle): Uint8Array =>
    nsDataToBytes(
      msgSendI64Ptr(rep, rt.selectors.get('representationUsingType:properties:'), type, properties),
    );
  const bytes = represent(handle);
  if (bytes.length > 0) {
    return bytes;
  }
  // ImageIO rejects some decoded layouts (e.g. 8-bit gray+alpha); encode an RGBA redraw instead.
  const width = Number(msgSendReturnsI64(handle, rt.selectors.get('pixelsWide')));
  const height = Number(msgSendReturnsI64(handle, rt.selectors.get('pixelsHigh')));
  const rgba = redraw(handle, width, height, 0, 0, width, height);
  if (rgba.empty) {
    return bytes;
  }
  const redrawn = represent(rgba.handle);
  rt.msgSend(rgba.handle, rt.selectors.get('release'));
  return redrawn;
};

export const cocoaNativeImageBackend: NativeImageBackend = {
  decode: (source) => (typeof source === 'string' ? decodePath(source) : decodeBuffer(source)),
  encodePng: (handle: NativeImageHandle): Uint8Array =>
    encode(handle, NS_BITMAP_IMAGE_FILE_TYPE_PNG, 0n),
  encodeJpeg: (handle: NativeImageHandle, quality: number): Uint8Array => {
    if (handle === 0n) {
      return new Uint8Array(0);
    }
    const rt = cocoa();
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
    return encode(handle, NS_BITMAP_IMAGE_FILE_TYPE_JPEG, properties);
  },
  resize,
  crop,
  release: (handle) => {
    if (handle !== 0n) {
      cocoa().msgSend(handle, cocoa().selectors.get('release'));
    }
  },
};
