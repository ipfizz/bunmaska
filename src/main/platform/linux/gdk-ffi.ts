import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads GDK 4's display, system-beep, and clipboard symbols — the Linux
 * primitives behind Sambar's `shell.beep` and `clipboard`.
 *
 * In GTK 4 there is no standalone `libgdk-4.so`: GDK is compiled INTO the GTK 4
 * shared object, so its symbols are resolved from `libgtk-4.so.1` (the same
 * library {@link loadGtkFFI} opens). `gdk_display_get_default()` returns the
 * default `GdkDisplay*` (NULL if GTK was never initialised / there is no
 * display); `gdk_display_beep(display)` rings the system bell (a no-op under a
 * bell-less Xvfb session, which is fine — Sambar only needs it to not crash).
 *
 * Clipboard: `gdk_display_get_clipboard(display)` returns the display's
 * `GdkClipboard*` (owned by GDK, NOT to be freed). Reads are async-only:
 * `gdk_clipboard_read_text_async(clipboard, cancellable, GAsyncReadyCallback,
 * user_data)` kicks off the read and `gdk_clipboard_read_text_finish(clipboard,
 * GAsyncResult*, error)` returns a transfer-full `char*` (NULL on empty/none) to
 * be freed with `g_free`. Writes are synchronous: `gdk_content_provider_new_for_bytes`
 * wraps a `GBytes` as a content provider and `gdk_clipboard_set_content(clipboard,
 * provider)` installs it (a NULL provider clears the clipboard); it returns a
 * `gboolean`.
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
  gdk_display_get_clipboard: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (self, cancellable /*null*/, GAsyncReadyCallback, user_data /*null*/)
  gdk_clipboard_read_text_async: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (self, result, error /*null*/) -> transfer-full char* (NULL on empty/none)
  gdk_clipboard_read_text_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (self, provider /*GdkContentProvider* | null to clear*/) -> gboolean
  gdk_clipboard_set_content: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  // (mime_type /*cstring*/, bytes /*GBytes*/) -> GdkContentProvider* (takes a ref on bytes)
  gdk_content_provider_new_for_bytes: {
    args: [FFIType.cstring, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (display) -> GListModel* of GdkMonitor (owned by GDK, do NOT unref the model)
  gdk_display_get_monitors: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (monitor, GdkRectangle* out) -> void; fills a 4 x i32 [x, y, width, height]
  gdk_monitor_get_geometry: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (monitor) -> int device-pixel scale factor (>= 1)
  gdk_monitor_get_scale_factor: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
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
