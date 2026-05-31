import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads GIO's default-handler URI launcher — the Linux primitive behind
 * Sambar's `shell.openExternal`/`openPath`/`showItemInFolder`.
 *
 * `g_app_info_launch_default_for_uri(uri, context, error)` hands a URI to the
 * desktop's default handler (browser for `http(s):`, file manager for
 * `file:`) and returns a `gboolean`. Sambar passes `context = NULL` and
 * `error = NULL` and relies on the boolean return rather than `GError`
 * unwrapping. `libgio-2.0` is a hard dependency of GTK 4, so it is always
 * present wherever `libgtk-4` is.
 *
 * `g_file_get_path(file)` unwraps the `GFile*` returned by `GtkFileDialog` into
 * a transfer-full local-path `char*` (the dialog backend reads it then frees it
 * with `g_free`).
 *
 * Convention (matches the existing Linux loaders): `gboolean` is modelled as
 * {@link FFIType.i32} (compare `=== 1`), NOT `bool`; the `GAppLaunchContext*`
 * and `GError**` args are real pointers passed as `null`; `cstring` args are
 * NUL-terminated UTF-8 strings.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBGIO_PATH = 'libgio-2.0.so.0';

/** The GIO FFI symbol descriptor table. */
export const GIO_FFI_SYMBOLS = {
  g_app_info_launch_default_for_uri: {
    args: [FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  // Returns a transfer-full `char*` (the local filesystem path) for a GFile, or
  // NULL if the GFile has no native path. The caller MUST `g_free` the result.
  g_file_get_path: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (GListModel*) -> guint number of items
  g_list_model_get_n_items: {
    args: [FFIType.pointer],
    returns: FFIType.u32,
  },
  // (GListModel*, guint position) -> transfer-full gpointer (caller g_object_unref's)
  g_list_model_get_item: {
    args: [FFIType.pointer, FFIType.u32],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof GIO_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadGioFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGioFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBGIO_PATH, GIO_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
