import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads GLib's main-context iteration symbols plus `g_free`.
 *
 * GLib (not GTK directly) owns the main-loop primitives Sambar uses to pump the
 * Linux UI cooperatively, mirroring the macOS CoreFoundation pump (D020).
 * `libglib-2.0` is a hard dependency of GTK 4, so it is always present wherever
 * `libgtk-4` is.
 *
 * `g_main_context_iteration(context, may_block)` dispatches at most one set of
 * ready sources; a `NULL` context means the default one. `g_main_context_pending`
 * reports whether any sources are ready, letting us drain to quiescence without
 * ever blocking Bun's thread. `g_free` releases the transfer-full `char*`
 * returned by `jsc_value_to_string` (NULL-safe no-op).
 *
 * `g_bytes_new(data, size)` copies `size` bytes into a refcounted `GBytes*` (so
 * the source buffer need only outlive the call); `g_bytes_unref(bytes)` drops a
 * ref. These back the GDK clipboard write path, where the content provider takes
 * its own ref on the `GBytes` and the caller unrefs the local one.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBGLIB_PATH = 'libglib-2.0.so.0';

/** The GLib FFI symbol descriptor table. */
export const GLIB_FFI_SYMBOLS = {
  g_main_context_default: {
    args: [],
    returns: FFIType.pointer,
  },
  g_main_context_iteration: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.i32,
  },
  g_main_context_pending: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  g_free: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (data, size) -> GBytes* (copies the bytes; refcounted)
  g_bytes_new: {
    args: [FFIType.pointer, FFIType.u64],
    returns: FFIType.pointer,
  },
  g_bytes_unref: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (bytes) -> gsize length of the byte buffer.
  g_bytes_get_size: {
    args: [FFIType.pointer],
    returns: FFIType.u64,
  },
  // (bytes, size_out /*null ok*/) -> gconstpointer to the raw bytes (owned by GBytes).
  g_bytes_get_data: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (string) -> GQuark (a guint32 id). Used to build an error domain for the
  // GError handed to webkit_uri_scheme_request_finish_error.
  g_quark_from_string: {
    args: [FFIType.cstring],
    returns: FFIType.u32,
  },
  // (domain:GQuark, code:gint, message) -> GError* (transfer-full; g_error_free).
  g_error_new_literal: {
    args: [FFIType.u32, FFIType.i32, FFIType.cstring],
    returns: FFIType.pointer,
  },
  g_error_free: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof GLIB_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadGlibFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGlibFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBGLIB_PATH, GLIB_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
