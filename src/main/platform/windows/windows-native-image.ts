import { CFunction, FFIType, type Pointer, ptr, read, toArrayBuffer } from 'bun:ffi';
import type { DecodedImage, NativeImageBackend, NativeImageHandle } from '../../api/native-image';
import { wstr } from './win32';
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

/**
 * Windows `nativeImage` backend via GDI+, the WinCairo peer of the `NSImage`
 * (macOS) and GdkPixbuf (Linux) backends. Decoding takes a file path
 * (`GdipLoadImageFromFile`) or PNG/JPEG bytes (an `SHCreateMemStream` `IStream`,
 * then clone so the image owns no stream ref); encoding writes to an HGLOBAL-backed
 * stream and reads the bytes out via `GlobalLock` (avoiding `IStream::Read`).
 *
 * COM POLICY: GDI+ is a flat-C API and the streams are managed with flat ole32
 * (`CreateStreamOnHGlobal`/`GetHGlobalFromStream`), so the ONLY COM call is a
 * single `IUnknown::Release` — invoked here by walking the object's vtable
 * (`{@link releaseStream}`), the codebase's one, contained, documented COM vtable call.
 * JPEG quality is GDI+'s default in v1 (an `EncoderParameters` follow-up).
 */

const HANDLE_SIZE = 8;
const DWORD_SIZE = 4;
/** `IUnknown` vtable slot of `Release` (QueryInterface=0, AddRef=1, Release=2). */
const IUNKNOWN_RELEASE_SLOT = 2;
const POINTER_SIZE = 8;

let gdiplusStarted = false;

/** Initialise GDI+ once for the process (never shut down — it lives until exit). */
export const ensureGdiplus = (): void => {
  if (gdiplusStarted) {
    return;
  }
  const token = new Uint8Array(HANDLE_SIZE);
  const input = new Uint8Array(24); // GdiplusStartupInput
  new DataView(input.buffer).setUint32(0, 1, true); // GdiplusVersion = 1
  loadGdiplus().symbols.GdiplusStartup(ptr(token), ptr(input), null);
  gdiplusStarted = true;
};

/**
 * Release one COM object (an `IStream`) by walking its vtable to `IUnknown::Release`
 * and calling it. The single COM vtable call in the codebase — every other Windows
 * surface is flat-C. `read.u64` reads the object's vtable pointer and the function
 * pointer at the Release slot; `CFunction` makes that address callable.
 */
const releaseStream = (object: bigint): void => {
  const vtable = read.u64(Number(object) as Pointer, 0);
  const releaseFn = read.u64(Number(vtable) as Pointer, IUNKNOWN_RELEASE_SLOT * POINTER_SIZE);
  const release = CFunction({
    ptr: Number(releaseFn) as Pointer,
    args: [FFIType.u64],
    returns: FFIType.u32,
  });
  release(object);
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

/** Read one out-pointer (`GpImage*`/`GpBitmap*`/`GpGraphics*`) the GDI+ call wrote. */
const handleOut = (): { buffer: Uint8Array; pointer: ReturnType<typeof ptr> } => {
  const buffer = new Uint8Array(HANDLE_SIZE);
  return { buffer, pointer: ptr(buffer) };
};

const decode = (source: string | Uint8Array): DecodedImage => {
  ensureGdiplus();
  const gdip = loadGdiplus().symbols;
  const out = handleOut();
  if (typeof source === 'string') {
    const nameBuffer = wstr(source);
    if (gdip.GdipLoadImageFromFile(ptr(nameBuffer), out.pointer) !== GDIP_OK) {
      return toDecoded(0n);
    }
    return toDecoded(read.u64(out.pointer, 0));
  }
  if (source.length === 0) {
    // An empty buffer is an empty image — `ptr()` rejects zero-length views, so
    // short-circuit rather than fault (Electron's createFromBuffer([]) is empty).
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
  // Clone so the result owns no reference to the soon-to-be-released stream.
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
  ole32.CreateStreamOnHGlobal(0n, 1, streamOut.pointer); // fDeleteOnRelease = TRUE
  const stream = read.u64(streamOut.pointer, 0);
  if (gdip.GdipSaveImageToStream(handle, stream, ptr(encoderClsid), null) !== GDIP_OK) {
    releaseStream(stream);
    return new Uint8Array(0);
  }
  const hglobalOut = handleOut();
  ole32.GetHGlobalFromStream(stream, hglobalOut.pointer);
  const hglobal = read.u64(hglobalOut.pointer, 0);
  const dataPtr = kernel32.GlobalLock(hglobal);
  const size = Number(kernel32.GlobalSize(hglobal));
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
};
