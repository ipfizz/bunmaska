import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads JavaScriptCoreGTK 6.0 — a SEPARATE shared object from WebKitGTK
 * (`libjavascriptcoregtk-6.0.so.1`, NOT `libwebkitgtk-6.0.so.4`).
 *
 * In WebKitGTK 6.0 the `script-message-received` signal delivers a `JSCValue*`
 * directly; {@link jsc_value_to_string} converts it into the JSON IPC payload
 * string. Declared returning {@link FFIType.pointer} (NOT `cstring`) so the
 * transfer-full native string can be captured via `CString`, read, then freed
 * with `g_free` — declaring `cstring` would leak the string on every IPC
 * message.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBJSC_PATH = 'libjavascriptcoregtk-6.0.so.1';

/** The JavaScriptCoreGTK FFI symbol descriptor table. */
export const JSC_FFI_SYMBOLS = {
  jsc_value_to_string: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof JSC_FFI_SYMBOLS>> | undefined } = {
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
  const ffi = dlopen(LIBJSC_PATH, JSC_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
