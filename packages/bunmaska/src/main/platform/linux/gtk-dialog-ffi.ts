import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads the GTK 4 native-dialog symbols behind Bunmaska's `dialog` API:
 * `GtkAlertDialog` (message boxes) and `GtkFileDialog` (open/save panels), both
 * added in GTK 4.10. CI runs on ubuntu-latest (24.04 → GTK 4.12+), so these are
 * always available there.
 *
 * Declared separately from {@link loadGtkDialogFFI} so unit tests can assert ABI
 * shapes (arg arrays, return types) without `dlopen` on a non-Linux host.
 *
 * Convention (matches the existing Linux loaders): `gboolean` is modelled as
 * {@link FFIType.i32}; all GObject/GTK handles are real pointers
 * ({@link FFIType.pointer}); `cstring` args are NUL-terminated UTF-8 strings;
 * `GType` is {@link FFIType.u64}.
 *
 * Notes on the async pattern:
 * - `gtk_alert_dialog_choose` / `gtk_file_dialog_open` / `..._save` are
 *   non-blocking — they kick off a modal dialog and invoke a
 *   `GAsyncReadyCallback (source, GAsyncResult*, user_data) -> void` when the
 *   user settles it. The matching `*_finish(self, result, error)` extracts the
 *   value. The `GError**` arg is always passed as `null` here (dismissal is
 *   reported via the return value / sentinel rather than unwrapping the error).
 * - `gtk_alert_dialog_choose_finish` returns the clicked button index, or `-1`
 *   on dismissal (and sets the error).
 * - `gtk_file_dialog_open_finish` / `..._save_finish` return a `GFile*` (or
 *   `NULL` on cancel) which {@link gio-ffi}'s `g_file_get_path` unwraps.
 *
 * The `GtkAlertDialog` is constructed via the 2-arity `g_object_new(type, NULL)`
 * (exposed by {@link loadGtkDialogGObjectFFI}) to avoid the C-varargs
 * `gtk_alert_dialog_new(format, ...)` constructor.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBGTK_PATH = 'libgtk-4.so.1';
const LIBGOBJECT_PATH = 'libgobject-2.0.so.0';

/** The GTK 4 dialog FFI symbol descriptor table (from `libgtk-4.so.1`). */
export const GTK_DIALOG_FFI_SYMBOLS = {
  gtk_alert_dialog_get_type: {
    args: [],
    returns: FFIType.u64,
  },
  gtk_alert_dialog_set_message: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  gtk_alert_dialog_set_detail: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  gtk_alert_dialog_set_modal: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  // `labels` is a NULL-terminated `const char* const*` — pass `ptr()` of a
  // BigUint64Array of cstr pointers with a trailing 0n.
  gtk_alert_dialog_set_buttons: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (self, parent /*GtkWindow* | null*/, cancellable /*null*/, cb, user_data)
  gtk_alert_dialog_choose: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (self, result, error /*null*/) -> clicked button index (-1 on dismissal)
  gtk_alert_dialog_choose_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  gtk_file_dialog_new: {
    args: [],
    returns: FFIType.pointer,
  },
  gtk_file_dialog_set_title: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  gtk_file_dialog_set_modal: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  gtk_file_dialog_set_initial_name: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  gtk_file_dialog_open: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (self, result, error /*null*/) -> GFile* (NULL on cancel)
  gtk_file_dialog_open_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  gtk_file_dialog_save: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_file_dialog_save_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  gtk_file_filter_new: {
    args: [],
    returns: FFIType.pointer,
  },
  gtk_file_filter_add_pattern: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  gtk_file_filter_set_name: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  gtk_file_dialog_set_default_filter: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

/**
 * The 2-arity `g_object_new(GType, NULL)` from `libgobject-2.0.so.0`.
 *
 * `g_object_new` is true C varargs; matching the ABI requires the call shape to
 * match exactly. The existing {@link gobject-ffi} table declares a 4-arity
 * variant for the `WebKitWebView` construct-only path; the `GtkAlertDialog` is
 * built with no construct properties, so it needs this distinct 2-arity
 * declaration. The trailing pointer MUST be a true NULL terminator.
 */
export const GTK_DIALOG_GOBJECT_FFI_SYMBOLS = {
  g_object_new: {
    args: [FFIType.u64, FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: {
  gtk: ReturnType<typeof dlopen<typeof GTK_DIALOG_FFI_SYMBOLS>> | undefined;
  gobject: ReturnType<typeof dlopen<typeof GTK_DIALOG_GOBJECT_FFI_SYMBOLS>> | undefined;
} = { gtk: undefined, gobject: undefined };

const requireLinux = (fn: string): void => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `${fn}() is only supported on Linux; current platform is ${platform}`,
    );
  }
};

export const loadGtkDialogFFI = () => {
  requireLinux('loadGtkDialogFFI');
  if (cache.gtk) {
    return cache.gtk;
  }
  const ffi = dlopen(LIBGTK_PATH, GTK_DIALOG_FFI_SYMBOLS);
  cache.gtk = ffi;
  return ffi;
};

export const loadGtkDialogGObjectFFI = () => {
  requireLinux('loadGtkDialogGObjectFFI');
  if (cache.gobject) {
    return cache.gobject;
  }
  const ffi = dlopen(LIBGOBJECT_PATH, GTK_DIALOG_GOBJECT_FFI_SYMBOLS);
  cache.gobject = ffi;
  return ffi;
};
