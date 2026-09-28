import { FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

/** JavaScriptCoreGTK is its own shared object, separate from libwebkitgtk. */
const LIBJSC_PATH = 'libjavascriptcoregtk-6.0.so.1';

export const JSC_FFI_SYMBOLS = {
  // (JSCValue*) -> char* (transfer-full): keep the pointer and g_free it, or every IPC message
  // leaks one string.
  jsc_value_to_string: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopenLinux<typeof JSC_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadJscFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadJscFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopenLinux(LIBJSC_PATH, JSC_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
