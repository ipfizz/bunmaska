import { FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

const LIBGOBJECT_PATH = 'libgobject-2.0.so.0';

/** Default `GConnectFlags` (no after/swapped) for `g_signal_connect_data`. */
export const G_CONNECT_DEFAULT = 0;

/** `gulong` handler ids and `GType`s are u64 (BigInt), never pointer. */
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
  g_object_unref: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // C varargs pinned to (type, name, value, NULL): one pointer-valued property, or a NULL name
  // for none. The trailing NULL terminator is mandatory or g_object_new walks past the args.
  g_object_new: {
    args: [FFIType.u64, FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // C varargs pinned to (object, name, &out, NULL): reads ONE property into a caller-owned buffer.
  g_object_get: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopenLinux<typeof GOBJECT_FFI_SYMBOLS>> | undefined } = {
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
  const ffi = dlopenLinux(LIBGOBJECT_PATH, GOBJECT_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
