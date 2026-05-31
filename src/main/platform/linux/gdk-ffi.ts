import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads GDK 4's display + system-beep symbols — the Linux primitive behind
 * Sambar's `shell.beep`.
 *
 * In GTK 4 there is no standalone `libgdk-4.so`: GDK is compiled INTO the GTK 4
 * shared object, so its symbols are resolved from `libgtk-4.so.1` (the same
 * library {@link loadGtkFFI} opens). `gdk_display_get_default()` returns the
 * default `GdkDisplay*` (NULL if GTK was never initialised / there is no
 * display); `gdk_display_beep(display)` rings the system bell (a no-op under a
 * bell-less Xvfb session, which is fine — Sambar only needs it to not crash).
 *
 * Convention (matches the existing Linux loaders): all GDK handles are real
 * pointers ({@link FFIType.pointer}); the display pointer is nullable and MUST
 * be guarded before `gdk_display_beep`.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBGTK_PATH = 'libgtk-4.so.1';

/** The GDK 4 FFI symbol descriptor table (resolved from `libgtk-4.so.1`). */
export const GDK_FFI_SYMBOLS = {
  gdk_display_get_default: {
    args: [],
    returns: FFIType.pointer,
  },
  gdk_display_beep: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof GDK_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadGdkFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGdkFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBGTK_PATH, GDK_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
