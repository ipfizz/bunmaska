import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

const LIBGTK_PATH = 'libgtk-4.so.1';

/**
 * The GTK 4 FFI symbol descriptor table.
 *
 * Declared separately from {@link loadGtkFFI} so unit tests can assert ABI
 * shapes (arg arrays, return types) without `dlopen` on a non-Linux host.
 *
 * Convention (matches the existing Linux loaders): `gboolean` is modelled as
 * {@link FFIType.i32} (compare `!== 0`), NOT `bool`; all GObject/GTK handles are
 * real pointers ({@link FFIType.pointer}); `cstring` args are NUL-terminated
 * UTF-8 strings.
 */
export const GTK_FFI_SYMBOLS = {
  gtk_init_check: {
    args: [],
    returns: FFIType.i32,
  },
  gtk_window_new: {
    args: [],
    returns: FFIType.pointer,
  },
  gtk_window_set_title: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  gtk_window_get_title: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  gtk_window_set_default_size: {
    args: [FFIType.pointer, FFIType.i32, FFIType.i32],
    returns: FFIType.void,
  },
  // (widget, opacity 0..1) -> void
  gtk_widget_set_opacity: {
    args: [FFIType.pointer, FFIType.f64],
    returns: FFIType.void,
  },
  // (widget, min_width, min_height) -> void; constrains the window's minimum size.
  gtk_widget_set_size_request: {
    args: [FFIType.pointer, FFIType.i32, FFIType.i32],
    returns: FFIType.void,
  },
  gtk_window_present: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_window_set_child: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_widget_set_visible: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  gtk_window_destroy: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_window_minimize: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_window_unminimize: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_window_maximize: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_window_unmaximize: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_window_is_maximized: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  gtk_window_is_active: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  gtk_widget_get_width: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  gtk_widget_get_height: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  gtk_widget_grab_focus: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  gtk_about_dialog_new: {
    args: [],
    returns: FFIType.pointer,
  },
  gtk_window_set_decorated: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  gtk_window_set_resizable: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  gtk_window_fullscreen: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_window_unfullscreen: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  gtk_window_is_fullscreen: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  gtk_settings_get_default: {
    args: [],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof GTK_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

/**
 * Open `libgtk-4.so.1` and expose the GTK 4 window/widget symbols Bunmaska needs.
 * Mirrors {@link loadCocoaFFI}'s shape: platform-guarded, lazy single-`dlopen`,
 * throws on non-Linux so the module is safely importable on macOS for unit
 * testing.
 *
 * GTK 3 -> GTK 4 changes reflected here: `gtk_init_check`/`gtk_window_new` take
 * no arguments; `gtk_window_set_child` replaces `gtk_container_add`;
 * `gtk_widget_set_visible` replaces `gtk_widget_show`/`hide`; `minimize`/
 * `unminimize` are the GTK 4 renames of `iconify`/`deiconify`. There is no
 * `gtk_window_is_minimized` — minimized state is tracked in JS.
 */
export const loadGtkFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadGtkFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBGTK_PATH, GTK_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};
