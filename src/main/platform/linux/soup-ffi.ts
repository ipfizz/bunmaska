import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { engineLibPath, prepareEngineForLoad, resolveEngine } from '../../engine/resolve';

/**
 * Loads libsoup 3 - the HTTP library WebKitGTK's cookie API traffics in.
 * Soup symbols are NOT reachable through the libwebkitgtk dlopen handle, so
 * this is its own library, engine-resolved like webkitgtk-ffi (a pinned
 * engine bundles its own libsoup).
 *
 * Convention: `gboolean` is {@link FFIType.i32} (compare `!== 0`); the
 * `soup_cookie_get_*` string getters return BORROWED `const char*` declared as
 * {@link FFIType.pointer} so NULL is guardable and nothing is freed.
 */

const LIBSOUP_PATH = 'libsoup-3.0.so.0';

export const SOUP_FFI_SYMBOLS = {
  // (name, value, domain, path, max_age /*int seconds; -1 = session cookie*/) -> SoupCookie*
  // (transfer-full: soup_cookie_free).
  soup_cookie_new: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.cstring, FFIType.i32],
    returns: FFIType.pointer,
  },
  soup_cookie_free: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  soup_cookie_get_name: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  soup_cookie_get_value: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  soup_cookie_get_domain: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  soup_cookie_get_path: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  soup_cookie_get_secure: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  soup_cookie_get_http_only: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  // (SoupCookie*) -> GDateTime* (BORROWED - do NOT unref; NULL for a session cookie).
  soup_cookie_get_expires: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  soup_cookie_set_secure: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  soup_cookie_set_http_only: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof SOUP_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadSoupFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadSoupFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const engine = resolveEngine();
  prepareEngineForLoad(engine, process.env, (text) => process.stderr.write(text));
  const ffi = dlopen(engineLibPath(engine, LIBSOUP_PATH), SOUP_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
