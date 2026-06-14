import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads GdkPixbuf's load/query/encode symbols — the Linux primitives behind
 * Bunmaska's `nativeImage`.
 *
 * GdkPixbuf is a small, stable library that decodes the common raster formats
 * (PNG/JPEG/…) and is a transitive dependency of GTK 4, but it ships as its own
 * shared object (`libgdk_pixbuf-2.0.so.0`) rather than living inside
 * `libgtk-4.so.1`, so it gets its own loader.
 *
 * LOAD — `gdk_pixbuf_new_from_file(path, &error)` returns a transfer-full
 * `GdkPixbuf*` (NULL on a bad/unreadable/undecodable path). `gdk_pixbuf_new_from_stream
 * (stream, cancellable, &error)` decodes from a `GInputStream` (NULL on failure);
 * the buffer path wraps the bytes in a `GMemoryInputStream` via
 * `g_memory_input_stream_new_from_bytes` (gio).
 *
 * SIZE — `gdk_pixbuf_get_width` / `gdk_pixbuf_get_height` are plain `int`
 * SCALARS (no struct crosses FFI), mirroring the macOS `pixelsWide`/`pixelsHigh`
 * scalar path.
 *
 * ENCODE — `gdk_pixbuf_save_to_bufferv(pixbuf, &buffer, &size, "png", NULL,
 * NULL, &error)` allocates a `guint8*` PNG buffer (out-param) and writes its
 * `gsize` length (out-param); the caller `g_free`s the buffer after copying it
 * out. The optionless `…v` variant is used so the trailing key/value `char**`
 * arrays are simply NULL.
 *
 * Convention (matches the existing Linux loaders): `gboolean` is {@link FFIType.i32}
 * (compare `=== 1`); `GError**`, `GCancellable*`, and the out-pointer args are
 * real pointers; `cstring` args are NUL-terminated UTF-8.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBGDK_PIXBUF_PATH = 'libgdk_pixbuf-2.0.so.0';

/** The GdkPixbuf FFI symbol descriptor table. */
export const GDK_PIXBUF_FFI_SYMBOLS = {
  // (filename, GError** error) -> GdkPixbuf* (transfer-full; NULL on failure)
  gdk_pixbuf_new_from_file: {
    args: [FFIType.cstring, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (GInputStream*, GCancellable* /*null*/, GError** error) -> GdkPixbuf* (transfer-full; NULL on failure)
  gdk_pixbuf_new_from_stream: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (GdkPixbuf*) -> int width (scalar)
  gdk_pixbuf_get_width: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  // (GdkPixbuf*) -> int height (scalar)
  gdk_pixbuf_get_height: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  // (GdkPixbuf*) -> guchar* to the packed pixel rows (BORROWED — owned by the pixbuf).
  gdk_pixbuf_get_pixels: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (GdkPixbuf*) -> int rowstride (bytes per row; ≥ width*n_channels, often padded).
  gdk_pixbuf_get_rowstride: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  // (GdkPixbuf*) -> int channels (3 = RGB, 4 = RGBA).
  gdk_pixbuf_get_n_channels: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  // (GdkPixbuf*) -> gboolean whether the pixbuf has an alpha channel.
  gdk_pixbuf_get_has_alpha: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  // (src, dest_width, dest_height, GdkInterpType /*BILINEAR=2*/) -> GdkPixbuf* (transfer-full)
  gdk_pixbuf_scale_simple: {
    args: [FFIType.pointer, FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.pointer,
  },
  // (src, x, y, w, h) -> GdkPixbuf* (transfer-full; SHARES the parent's pixels + refs it).
  gdk_pixbuf_new_subpixbuf: {
    args: [FFIType.pointer, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.pointer,
  },
  // (src) -> GdkPixbuf* (transfer-full; an INDEPENDENT pixel copy — used to detach a subpixbuf).
  gdk_pixbuf_copy: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (GdkPixbuf*, gchar** buffer /*out*/, gsize* buffer_size /*out*/, type, char** keys /*null*/, char** vals /*null*/, GError** error) -> gboolean
  gdk_pixbuf_save_to_bufferv: {
    args: [
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.i32,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof GDK_PIXBUF_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadGdkPixbufFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGdkPixbufFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBGDK_PIXBUF_PATH, GDK_PIXBUF_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
