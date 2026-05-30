import { dlopen, FFIType } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads WebKitGTK 6.0 — the Linux system-WebKit web view (the role
 * `WebKit.framework` plays on macOS).
 *
 * `webkit_web_view_new()` returns a `GtkWidget*` set as a window's child via
 * `gtk_window_set_child`. URLs and inline HTML load through `load_uri` /
 * `load_html`; `get_uri` reads the current address back. JS evaluation and the
 * user-content-manager IPC bridge are added in later increments alongside their
 * tests.
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBWEBKITGTK_PATH = 'libwebkitgtk-6.0.so.4';

export const loadWebKitGtkFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadWebKitGtkFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  return dlopen(LIBWEBKITGTK_PATH, {
    webkit_web_view_new: {
      args: [],
      returns: FFIType.pointer,
    },
    webkit_web_view_load_uri: {
      args: [FFIType.pointer, FFIType.cstring],
      returns: FFIType.void,
    },
    webkit_web_view_load_html: {
      args: [FFIType.pointer, FFIType.cstring, FFIType.cstring],
      returns: FFIType.void,
    },
    webkit_web_view_get_uri: {
      args: [FFIType.pointer],
      returns: FFIType.cstring,
    },
  });
};
