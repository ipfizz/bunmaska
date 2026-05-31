import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads GObject's signal-connection and refcount primitives plus the
 * construct-only `g_object_new` path used to build a `WebKitWebView` with a
 * pre-wired `WebKitUserContentManager`.
 *
 * `libgobject-2.0` is a hard dependency of GTK 4, so it is always present
 * wherever `libgtk-4` is. Convention: `gboolean` is {@link FFIType.i32};
 * `gulong`/`GType` are {@link FFIType.u64} (BigInt); `GConnectFlags` is
 * {@link FFIType.u32}; all handles are real pointers.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBGOBJECT_PATH = 'libgobject-2.0.so.0';

/** Default `GConnectFlags` (no after/swapped) for `g_signal_connect_data`. */
export const G_CONNECT_DEFAULT = 0;

/**
 * The GObject FFI symbol descriptor table.
 *
 * `g_signal_connect_data` is the real symbol behind the `g_signal_connect`
 * C macro; pass `c_handler = jsCallback.ptr`, `data = 0`, `destroy_data = 0`,
 * `connect_flags = 0`. It returns the `gulong` handler id kept as a BigInt.
 *
 * `g_object_new` is true C varargs; the fixed 4-arity `[u64, cstring, ptr, ptr]`
 * is valid ONLY for the literal call
 * `(webkit_web_view_get_type(), "user-content-manager", ucm, NULL)`. The
 * trailing pointer MUST be a real null terminator or g_object_new walks past the
 * varargs and corrupts/crashes.
 */
export const GOBJECT_FFI_SYMBOLS = {
  g_signal_connect_data: {
    args: [
      FFIType.pointer,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.u32,
    ],
    returns: FFIType.u64,
  },
  g_signal_handler_disconnect: {
    args: [FFIType.pointer, FFIType.u64],
    returns: FFIType.void,
  },
  g_object_ref: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  g_object_unref: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  g_object_new: {
    args: [FFIType.u64, FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof GOBJECT_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadGObjectFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGObjectFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBGOBJECT_PATH, GOBJECT_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
