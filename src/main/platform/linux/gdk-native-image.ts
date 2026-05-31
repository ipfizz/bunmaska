import { ptr, toArrayBuffer } from 'bun:ffi';
import type { DecodedImage, NativeImageBackend, NativeImageHandle } from '../../api/native-image';
import { cstr } from '../cstr';
import { loadGdkPixbufFFI } from './gdk-pixbuf-ffi';
import { loadGioFFI } from './gio-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';

/**
 * Linux image backend for `nativeImage`, via GdkPixbuf.
 *
 * DECODE — `gdk_pixbuf_new_from_file` for a path; for a buffer the bytes are
 * copied into a refcounted `GBytes` (`g_bytes_new`), wrapped as a
 * `GMemoryInputStream` (`g_memory_input_stream_new_from_bytes`), and decoded
 * with `gdk_pixbuf_new_from_stream`. A NULL pixbuf (bad path / undecodable
 * bytes) is reported empty — no placeholder is fabricated.
 *
 * SIZE WITHOUT A STRUCT — `gdk_pixbuf_get_width` / `gdk_pixbuf_get_height` are
 * plain `int` SCALARS, so `getSize` needs no struct return (the Linux mirror of
 * the macOS `pixelsWide`/`pixelsHigh` scalar path).
 *
 * ENCODE — `gdk_pixbuf_save_to_bufferv(pixbuf, &buffer, &size, "png", NULL,
 * NULL, &error)` writes an out `guint8*` and out `gsize`; we copy the buffer out
 * with `toArrayBuffer` then `g_free` it.
 *
 * The decoded handle carries the live `GdkPixbuf*` (as a bigint). We do NOT
 * unref it here — its lifetime is the JS `NativeImage`'s, and Sambar has no
 * finalizer hook yet, so the pixbuf is intentionally leaked for the image's
 * lifetime (documented; matches how other Linux handles are retained). The
 * transient `GBytes` and `GInputStream` of the buffer path ARE freed.
 */

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

const decodePath = (path: string): DecodedImage => {
  const pixbufFFI = loadGdkPixbufFFI();
  const pixbuf = pixbufFFI.symbols.gdk_pixbuf_new_from_file(cstr(path), null);
  return decodeFromPixbuf(pixbuf === null ? null : Number(pixbuf));
};

const decodeBuffer = (bytes: Uint8Array): DecodedImage => {
  const pixbufFFI = loadGdkPixbufFFI();
  const glib = loadGlibFFI();
  const gio = loadGioFFI();
  const gobject = loadGObjectFFI();

  const dataPtr = bytes.length === 0 ? null : ptr(bytes);
  const gbytes = glib.symbols.g_bytes_new(dataPtr, BigInt(bytes.length));
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

/** Linux implementation of {@link NativeImageBackend}. */
export const gdkNativeImageBackend: NativeImageBackend = {
  decode: (source) => (typeof source === 'string' ? decodePath(source) : decodeBuffer(source)),
  encodePng: (handle: NativeImageHandle): Uint8Array => {
    const pixbuf = handleToPtr(handle);
    if (pixbuf === null) {
      return new Uint8Array(0);
    }
    const pixbufFFI = loadGdkPixbufFFI();
    const glib = loadGlibFFI();

    // Out-params: a gchar** slot for the buffer pointer and a gsize* slot for
    // its length, mirroring the BigInt64Array out-pointer pattern used elsewhere.
    const bufferOut = new BigUint64Array(1);
    const sizeOut = new BigUint64Array(1);
    const ok = pixbufFFI.symbols.gdk_pixbuf_save_to_bufferv(
      pixbuf as Parameters<typeof pixbufFFI.symbols.gdk_pixbuf_save_to_bufferv>[0],
      ptr(bufferOut),
      ptr(sizeOut),
      cstr('png'),
      null,
      null,
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
    glib.symbols.g_free(Number(outPtr) as Parameters<typeof glib.symbols.g_free>[0]);
    return copy;
  },
};
