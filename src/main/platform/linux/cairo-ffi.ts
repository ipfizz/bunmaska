import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { engineLibPath, prepareEngineForLoad, resolveEngine } from '../../engine/resolve';

/** Loads the two cairo symbols the snapshot path needs (engine-resolved like webkitgtk-ffi). */

const LIBCAIRO_PATH = 'libcairo.so.2';

export const CAIRO_FFI_SYMBOLS = {
  // (cairo_surface_t*, filename) -> cairo_status_t (i32 enum; 0 = CAIRO_STATUS_SUCCESS).
  cairo_surface_write_to_png: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.i32,
  },
  cairo_surface_destroy: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof CAIRO_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadCairoFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadCairoFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const engine = resolveEngine();
  prepareEngineForLoad(engine, process.env, (text) => process.stderr.write(text));
  const ffi = dlopen(engineLibPath(engine, LIBCAIRO_PATH), CAIRO_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
