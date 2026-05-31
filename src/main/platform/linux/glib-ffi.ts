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
