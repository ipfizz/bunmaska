import { CString, dlopen, FFIType, type Pointer } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';

/**
 * Loads WebKitGTK 6.0 — the Linux system-WebKit web view (the role
 * `WebKit.framework` plays on macOS).
 *
 * `webkit_web_view_new()` returns a `GtkWidget*` set as a window's child via
 * `gtk_window_set_child`. URLs and inline HTML load through `load_uri` /
 * `load_html`; `get_uri` reads the current address back. JS evaluation and the
 * user-content-manager IPC bridge are wired here too.
 *
 * Convention: `gboolean` is {@link FFIType.i32} (compare `!== 0`); handles are
 * real pointers; nullable string args use {@link FFIType.pointer} (Bun's
 * `cstring` cannot encode NULL).
 *
 * Only callable on Linux — throws {@link UnsupportedPlatformError} otherwise so
 * the module stays safely importable on macOS for unit testing.
 */

const LIBWEBKITGTK_PATH = 'libwebkitgtk-6.0.so.4';

/** `WebKitLoadEvent` value matched in `load-changed` to fire `onDidFinishLoad`. */
export const WEBKIT_LOAD_FINISHED = 3;
/** `WebKitUserContentInjectedFrames`: inject the preload into every frame. */
export const WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES = 0;
/** `WebKitUserScriptInjectionTime`: inject the preload at document start. */
export const WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START = 0;

/**
 * The WebKitGTK 6.0 FFI symbol descriptor table.
 *
 * Declared separately from {@link loadWebKitGtkFFI} so unit tests can assert ABI
 * shapes without `dlopen` on a non-Linux host. Load-bearing details:
 * - `load_html` base_uri is {@link FFIType.pointer} (nullable; was wrongly
 *   `cstring` in the scaffolding) — pass a pinned NUL-terminated Buffer or 0.
 * - `evaluate_javascript` is the 8-arg WK6.0 form; length is `i64` (-1 for
 *   NUL-terminated); world_name/source_uri/cancellable/callback/user_data are
 *   pointers passable as null for fire-and-forget (D022).
 * - `register_script_message_handler` is the WK6.0 3-arg form; the trailing
 *   world_name is {@link FFIType.pointer} (nullable; 0 = default world).
 */
export const WEBKITGTK_FFI_SYMBOLS = {
  webkit_web_view_new: {
    args: [],
    returns: FFIType.pointer,
  },
  webkit_web_view_get_type: {
    args: [],
    returns: FFIType.u64,
  },
  webkit_web_view_load_uri: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  webkit_web_view_load_html: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer],
    returns: FFIType.void,
  },
  webkit_web_view_get_uri: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  webkit_web_view_reload: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  webkit_web_view_reload_bypass_cache: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  webkit_web_view_go_back: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  webkit_web_view_go_forward: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  webkit_web_view_can_go_back: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  webkit_web_view_can_go_forward: {
    args: [FFIType.pointer],
    returns: FFIType.i32,
  },
  webkit_web_view_evaluate_javascript: {
    args: [
      FFIType.pointer,
      FFIType.cstring,
      FFIType.i64,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.void,
  },
  webkit_web_view_get_user_content_manager: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  webkit_user_content_manager_new: {
    args: [],
    returns: FFIType.pointer,
  },
  webkit_user_content_manager_register_script_message_handler: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer],
    returns: FFIType.i32,
  },
  webkit_user_content_manager_add_script: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  webkit_user_script_new: {
    args: [FFIType.cstring, FFIType.i32, FFIType.i32, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopen<typeof WEBKITGTK_FFI_SYMBOLS>> | undefined } = {
  ffi: undefined,
};

export const loadWebKitGtkFFI = () => {
  const platform = currentPlatform();
  if (platform !== 'linux') {
    throw new UnsupportedPlatformError(
      `loadWebKitGtkFFI() is only supported on Linux; current platform is ${platform}`,
    );
  }
  if (cache.ffi) {
    return cache.ffi;
  }
  const ffi = dlopen(LIBWEBKITGTK_PATH, WEBKITGTK_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

/**
 * Decode the transfer-none `const char*` returned by `webkit_web_view_get_uri`.
 * The pointer is owned by WebKit and is NULL before the first load — guard it
 * and return `''` rather than freeing or decoding a null pointer.
 */
export const readGetUriResult = (ptr: Pointer | null): string =>
  ptr === null ? '' : new CString(ptr).toString();
