import { CFunction, FFIType, type Pointer, ptr, read, toArrayBuffer } from 'bun:ffi';
import { readFileSync } from 'node:fs';
import { FFIError } from '../../../common/errors';
import type { DecodedImage, NativeImageBackend, NativeImageHandle } from '../../api/native-image';
import { loadKernel32, loadOle32 } from './win32-ffi';
import {
  GDIP_OK,
  INTERPOLATION_HIGH_QUALITY_BICUBIC,
  JPEG_ENCODER_CLSID,
  loadGdiplus,
  loadShlwapi,
  PIXEL_FORMAT_32BPP_ARGB,
  PNG_ENCODER_CLSID,
} from './win32-gdiplus-ffi';

const HANDLE_SIZE = 8;
const DWORD_SIZE = 4;
/** `IUnknown` vtable slot of `Release` (QueryInterface=0, AddRef=1, Release=2). */
const IUNKNOWN_RELEASE_SLOT = 2;
/** `IStream::Seek` follows IUnknown (0-2) and ISequentialStream Read/Write (3-4). */
const ISTREAM_SEEK_SLOT = 5;
const STREAM_SEEK_END = 2;
const POINTER_SIZE = 8;

let gdiplusStarted = false;

/** Start GDI+ once; it is never shut down, so it lives until process exit. */
export const ensureGdiplus = (): void => {
  if (gdiplusStarted) {
    return;
  }
  const token = new Uint8Array(HANDLE_SIZE);
  const input = new Uint8Array(24); // GdiplusStartupInput
  new DataView(input.buffer).setUint32(0, 1, true); // GdiplusVersion = 1
  const status = loadGdiplus().symbols.GdiplusStartup(ptr(token), ptr(input), null);
  if (status !== GDIP_OK) {
    throw new FFIError(`nativeImage: GdiplusStartup failed (status ${status})`);
  }
  gdiplusStarted = true;
};

const comMethods = new Map<bigint, ReturnType<typeof CFunction>>();

/** Vtable `slot` of COM `object` as a callable, compiled once per method address. */
const comMethod = (
  object: bigint,
  slot: number,
  args: readonly FFIType[],
  returns: FFIType,
): ReturnType<typeof CFunction> => {
  const vtable = read.u64(Number(object) as Pointer, 0);
  const address = read.u64(Number(vtable) as Pointer, slot * POINTER_SIZE);
  let method = comMethods.get(address);
  if (method === undefined) {
    method = CFunction({ ptr: Number(address) as Pointer, args, returns });
    comMethods.set(address, method);
  }
  return method;
};

/** Drop our reference to an `IStream`. */
const releaseStream = (stream: bigint): void => {
  comMethod(stream, IUNKNOWN_RELEASE_SLOT, [FFIType.u64], FFIType.u32)(stream);
};

/** The stream's logical length (a seek to its end), or `undefined` if the seek fails. */
const streamLength = (stream: bigint): number | undefined => {
  const end = handleOut();
  const seek = comMethod(
    stream,
    ISTREAM_SEEK_SLOT,
    [FFIType.u64, FFIType.i64, FFIType.u32, FFIType.ptr],
    FFIType.i32,
  );
  return seek(stream, 0n, STREAM_SEEK_END, end.pointer) === 0
    ? Number(read.u64(end.pointer, 0))
    : undefined;
};

/** Read a GDI+ image's pixel dimensions via the scalar `GdipGetImage{Width,Height}` getters. */
const dimensions = (handle: bigint): { width: number; height: number } => {
  const gdip = loadGdiplus().symbols;
  const width = new Uint8Array(DWORD_SIZE);
  const widthPtr = ptr(width);
  gdip.GdipGetImageWidth(handle, widthPtr);
  const height = new Uint8Array(DWORD_SIZE);
  const heightPtr = ptr(height);
  gdip.GdipGetImageHeight(handle, heightPtr);
  return { width: read.u32(widthPtr, 0), height: read.u32(heightPtr, 0) };
};

/** Wrap a GDI+ image handle (or `0n`) in a {@link DecodedImage}. */
const toDecoded = (handle: bigint): DecodedImage => {
  if (handle === 0n) {
    return { handle: 0n, width: 0, height: 0, empty: true };
  }
  const { width, height } = dimensions(handle);
  return { handle, width, height, empty: false };
};

/** An 8-byte out-parameter slot for a handle a native call writes. */
const handleOut = (): { buffer: Uint8Array; pointer: ReturnType<typeof ptr> } => {
  const buffer = new Uint8Array(HANDLE_SIZE);
  return { buffer, pointer: ptr(buffer) };
};

const decode = (source: string | Uint8Array): DecodedImage => {
  if (typeof source === 'string') {
    // GdipLoadImageFromFile would share-lock the file for the image's lifetime.
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(source);
    } catch {
      return toDecoded(0n);
    }
    return decode(bytes);
  }
  ensureGdiplus();
  const gdip = loadGdiplus().symbols;
  const out = handleOut();
  if (source.length === 0) {
    // Empty in, empty out (as Electron); ptr() also rejects a zero-length view.
    return toDecoded(0n);
  }
  const stream = loadShlwapi().symbols.SHCreateMemStream(ptr(source), source.length);
  if (stream === 0n) {
    return toDecoded(0n);
  }
  if (gdip.GdipLoadImageFromStream(stream, out.pointer) !== GDIP_OK) {
    releaseStream(stream);
    return toDecoded(0n);
  }
  const image = read.u64(out.pointer, 0);
  // Keep only a clone: the stream-loaded image is tied to the stream released below.
  const clone = handleOut();
  gdip.GdipCloneImage(image, clone.pointer);
  gdip.GdipDisposeImage(image);
  releaseStream(stream);
  return toDecoded(read.u64(clone.pointer, 0));
};

const encode = (handle: NativeImageHandle, encoderClsid: Uint8Array): Uint8Array => {
  if (handle === 0n) {
    return new Uint8Array(0);
  }
  const gdip = loadGdiplus().symbols;
  const ole32 = loadOle32().symbols;
  const kernel32 = loadKernel32().symbols;
  const streamOut = handleOut();
  // fDeleteOnRelease = TRUE: releasing the stream frees its HGLOBAL.
  if (ole32.CreateStreamOnHGlobal(0n, 1, streamOut.pointer) !== 0) {
    return new Uint8Array(0);
  }
  const stream = read.u64(streamOut.pointer, 0);
  if (gdip.GdipSaveImageToStream(handle, stream, ptr(encoderClsid), null) !== GDIP_OK) {
    releaseStream(stream);
    return new Uint8Array(0);
  }
  const hglobalOut = handleOut();
  ole32.GetHGlobalFromStream(stream, hglobalOut.pointer);
  const hglobal = read.u64(hglobalOut.pointer, 0);
  const dataPtr = kernel32.GlobalLock(hglobal);
  // GlobalSize can exceed the bytes written; the stream tracks its own length.
  const allocated = Number(kernel32.GlobalSize(hglobal));
  const size = Math.min(allocated, streamLength(stream) ?? allocated);
  const bytes =
    dataPtr === null ? new Uint8Array(0) : new Uint8Array(toArrayBuffer(dataPtr, 0, size)).slice();
  kernel32.GlobalUnlock(hglobal);
  releaseStream(stream);
  return bytes;
};

export const windowsNativeImageBackend: NativeImageBackend = {
  decode,

  encodePng(handle: NativeImageHandle): Uint8Array {
    return encode(handle, PNG_ENCODER_CLSID);
  },

  // ponytail: GDI+'s default JPEG quality; honour `quality` via EncoderParameters
  encodeJpeg(handle: NativeImageHandle, _quality: number): Uint8Array {
    return encode(handle, JPEG_ENCODER_CLSID);
  },

  resize(handle: NativeImageHandle, width: number, height: number): DecodedImage {
    if (handle === 0n) {
      return toDecoded(0n);
    }
    const gdip = loadGdiplus().symbols;
    const bitmap = handleOut();
    if (
      gdip.GdipCreateBitmapFromScan0(
        width,
        height,
        0,
        PIXEL_FORMAT_32BPP_ARGB,
        null,
        bitmap.pointer,
      ) !== GDIP_OK
    ) {
      return toDecoded(0n);
    }
    const target = read.u64(bitmap.pointer, 0);
    const graphics = handleOut();
    gdip.GdipGetImageGraphicsContext(target, graphics.pointer);
    const context = read.u64(graphics.pointer, 0);
    gdip.GdipSetInterpolationMode(context, INTERPOLATION_HIGH_QUALITY_BICUBIC);
    gdip.GdipDrawImageRectI(context, handle, 0, 0, width, height);
    gdip.GdipDeleteGraphics(context);
    return toDecoded(target);
  },

  crop(
    handle: NativeImageHandle,
    x: number,
    y: number,
    width: number,
    height: number,
  ): DecodedImage {
    if (handle === 0n) {
      return toDecoded(0n);
    }
    const cropped = handleOut();
    if (
      loadGdiplus().symbols.GdipCloneBitmapAreaI(
        x,
        y,
        width,
        height,
        PIXEL_FORMAT_32BPP_ARGB,
        handle,
        cropped.pointer,
      ) !== GDIP_OK
    ) {
      return toDecoded(0n);
    }
    return toDecoded(read.u64(cropped.pointer, 0));
  },

  release(handle: NativeImageHandle): void {
    if (handle !== 0n) {
      loadGdiplus().symbols.GdipDisposeImage(handle);
    }
  },
};
