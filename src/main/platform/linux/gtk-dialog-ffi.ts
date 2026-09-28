import { FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

/** Needs GTK >= 4.10 (GtkAlertDialog/GtkFileDialog): Bun fails the whole table on older GTK. */
const LIBGTK_PATH = 'libgtk-4.so.1';
const LIBGOBJECT_PATH = 'libgobject-2.0.so.0';

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
  // `labels` is a NULL-terminated `const char* const*`: `ptr()` of a BigUint64Array of cstr
  // pointers with a trailing 0n.
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
  gtk_file_dialog_set_default_filter: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
} as const;

// ponytail: duplicate of gobject-ffi's g_object_new; delete once gtk-dialog.ts calls that one.
export const GTK_DIALOG_GOBJECT_FFI_SYMBOLS = {
  g_object_new: {
    args: [FFIType.u64, FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: {
  gtk: ReturnType<typeof dlopenLinux<typeof GTK_DIALOG_FFI_SYMBOLS>> | undefined;
  gobject: ReturnType<typeof dlopenLinux<typeof GTK_DIALOG_GOBJECT_FFI_SYMBOLS>> | undefined;
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
  const ffi = dlopenLinux(LIBGTK_PATH, GTK_DIALOG_FFI_SYMBOLS);
  cache.gtk = ffi;
  return ffi;
};

export const loadGtkDialogGObjectFFI = () => {
  requireLinux('loadGtkDialogGObjectFFI');
  if (cache.gobject) {
    return cache.gobject;
  }
  const ffi = dlopenLinux(LIBGOBJECT_PATH, GTK_DIALOG_GOBJECT_FFI_SYMBOLS);
  cache.gobject = ffi;
  return ffi;
};
