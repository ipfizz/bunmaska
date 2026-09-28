import { readFileSync } from 'node:fs';
import { ptr, toArrayBuffer } from 'bun:ffi';
import type { DecodedImage, NativeImageBackend, NativeImageHandle } from '../../api/native-image';
import { cstr } from '../cstr';
import { loadGdkPixbufFFI } from './gdk-pixbuf-ffi';
import { loadGioFFI } from './gio-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';

// ponytail: decoded, resized and cropped GdkPixbufs are never unref'd (one per image for the process
// lifetime); fix with a NativeImageBackend.release driven by a FinalizationRegistry in api/native-image.ts.

const handleToPtr = (handle: NativeImageHandle) => (handle === 0n ? null : Number(handle));

const EMPTY: DecodedImage = { handle: 0n, width: 0, height: 0, empty: true };

const decodeFromPixbuf = (pixbuf: number | null): DecodedImage => {
  if (pixbuf === null || pixbuf === 0) {
    return EMPTY;
  }
  const pixbufFFI = loadGdkPixbufFFI();
  const pixbufPtr = pixbuf as Parameters<typeof pixbufFFI.symbols.gdk_pixbuf_get_width>[0];
  const width = pixbufFFI.symbols.gdk_pixbuf_get_width(pixbufPtr);
  const height = pixbufFFI.symbols.gdk_pixbuf_get_height(pixbufPtr);
  if (width <= 0 || height <= 0) {
    return EMPTY;
  }
  return { handle: BigInt(pixbuf), width, height, empty: false };
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SOI = [0xff, 0xd8, 0xff];

/** gdk-pixbuf sniffs bytes into every installed loader (TGA, ANI, SVG, ...); the contract is PNG/JPEG only. */
export const isPngOrJpeg = (bytes: Uint8Array): boolean =>
  [PNG_SIGNATURE, JPEG_SOI].some((magic) => magic.every((byte, i) => bytes[i] === byte));

const decodeBuffer = (bytes: Uint8Array): DecodedImage => {
  if (!isPngOrJpeg(bytes)) {
    return EMPTY;
  }
  const pixbufFFI = loadGdkPixbufFFI();
  const glib = loadGlibFFI();
  const gio = loadGioFFI();
  const gobject = loadGObjectFFI();

  const gbytes = glib.symbols.g_bytes_new(ptr(bytes), BigInt(bytes.length));
  const stream = gio.symbols.g_memory_input_stream_new_from_bytes(gbytes);
  // The stream took its own ref on the bytes; drop our local one.
  glib.symbols.g_bytes_unref(gbytes);

  const pixbuf =
    stream === null ? null : pixbufFFI.symbols.gdk_pixbuf_new_from_stream(stream, null, null);
  if (stream !== null) {
    gobject.symbols.g_object_unref(stream);
  }
  return decodeFromPixbuf(pixbuf === null ? null : Number(pixbuf));
};

const decodePath = (path: string): DecodedImage => {
  try {
    return decodeBuffer(readFileSync(path));
  } catch {
    return EMPTY;
  }
};

/** Encode to `type` ("png"/"jpeg"); `quality` (0-100) applies to JPEG only. */
const encode = (handle: NativeImageHandle, type: string, quality?: number): Uint8Array => {
  const pixbuf = handleToPtr(handle);
  if (pixbuf === null) {
    return new Uint8Array(0);
  }
  const pixbufFFI = loadGdkPixbufFFI();
  const glib = loadGlibFFI();

  const bufferOut = new BigUint64Array(1);
  const sizeOut = new BigUint64Array(1);
  // NULL-terminated char** option lists; [NULL] alone means no options.
  const key = cstr('quality');
  const value = cstr(String(Math.min(100, Math.max(0, Math.round(quality ?? 0)))));
  const optionKeys = new BigUint64Array(2);
  const optionValues = new BigUint64Array(2);
  if (quality !== undefined) {
    optionKeys[0] = BigInt(ptr(key));
    optionValues[0] = BigInt(ptr(value));
  }
  const ok = pixbufFFI.symbols.gdk_pixbuf_save_to_bufferv(
    pixbuf as Parameters<typeof pixbufFFI.symbols.gdk_pixbuf_save_to_bufferv>[0],
    ptr(bufferOut),
    ptr(sizeOut),
    cstr(type),
    ptr(optionKeys),
    ptr(optionValues),
    null,
  );
  if (ok !== 1) {
    return new Uint8Array(0);
  }
  const outPtr = bufferOut[0] ?? 0n;
  const size = Number(sizeOut[0] ?? 0n);
  if (outPtr === 0n || size <= 0) {
    return new Uint8Array(0);
  }
  const copy = new Uint8Array(
    toArrayBuffer(Number(outPtr) as Parameters<typeof toArrayBuffer>[0], 0, size).slice(0),
  );
  // The out buffer is g_malloc'd: copy, then g_free.
  glib.symbols.g_free(Number(outPtr) as Parameters<typeof glib.symbols.g_free>[0]);
  return copy;
};

/** `GdkInterpType` BILINEAR. */
const GDK_INTERP_BILINEAR = 2;

const resize = (handle: NativeImageHandle, width: number, height: number): DecodedImage => {
  const pixbuf = handleToPtr(handle);
  if (pixbuf === null) {
    return EMPTY;
  }
  const pixbufFFI = loadGdkPixbufFFI();
  const out = pixbufFFI.symbols.gdk_pixbuf_scale_simple(
    pixbuf as Parameters<typeof pixbufFFI.symbols.gdk_pixbuf_scale_simple>[0],
    width,
    height,
    GDK_INTERP_BILINEAR,
  );
  return decodeFromPixbuf(out === null ? null : Number(out));
};

const crop = (
  handle: NativeImageHandle,
  x: number,
  y: number,
  width: number,
  height: number,
): DecodedImage => {
  const pixbuf = handleToPtr(handle);
  if (pixbuf === null) {
    return EMPTY;
  }
  const pixbufFFI = loadGdkPixbufFFI();
  const sub = pixbufFFI.symbols.gdk_pixbuf_new_subpixbuf(
    pixbuf as Parameters<typeof pixbufFFI.symbols.gdk_pixbuf_new_subpixbuf>[0],
    x,
    y,
    width,
    height,
  );
  if (sub === null) {
    return EMPTY;
  }
  // A subpixbuf shares (and refs) the parent's pixels: copy it out, then unref the sub.
  const copy = pixbufFFI.symbols.gdk_pixbuf_copy(sub);
  loadGObjectFFI().symbols.g_object_unref(sub);
  return decodeFromPixbuf(copy === null ? null : Number(copy));
};

export const gdkNativeImageBackend: NativeImageBackend = {
  decode: (source) => (typeof source === 'string' ? decodePath(source) : decodeBuffer(source)),
  encodePng: (handle: NativeImageHandle): Uint8Array => encode(handle, 'png'),
  encodeJpeg: (handle: NativeImageHandle, quality: number): Uint8Array =>
    encode(handle, 'jpeg', quality),
  resize,
  crop,
};
