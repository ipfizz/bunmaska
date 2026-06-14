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

export const WEBKIT_LOAD_STARTED = 0;
export const WEBKIT_LOAD_COMMITTED = 2;
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
 * - `webkit_user_script_new_for_world` is the named-world variant of
 *   `webkit_user_script_new`; its 4th arg (`world_name`) is {@link FFIType.cstring}
 *   (a real world name, e.g. `BunmaskaPreload`) — the isolated-world injection path.
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
  // (web_view) -> void; aborts any in-progress load.
  webkit_web_view_stop_loading: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (web_view) -> const gchar* title (BORROWED — do NOT free; NULL when none).
  webkit_web_view_get_title: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (web_view, command /*e.g. "Copy","Paste","Cut","SelectAll","Undo","Redo"*/) -> void.
  // Non-blocking — queues into the web process. Backs Menu edit-role clicks on Linux.
  webkit_web_view_execute_editing_command: {
    args: [FFIType.pointer, FFIType.cstring],
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
  webkit_web_view_set_zoom_level: {
    args: [FFIType.pointer, FFIType.f64],
    returns: FFIType.void,
  },
  // (WebKitNavigationAction*) -> WebKitURIRequest* (transfer-none).
  webkit_navigation_action_get_request: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (WebKitURIRequest*) -> const char* uri (transfer-none).
  webkit_uri_request_get_uri: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
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
  webkit_web_view_get_settings: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  webkit_settings_set_enable_developer_extras: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  // (settings, user_agent /*cstring; null resets to default*/) -> void
  webkit_settings_set_user_agent: {
    args: [FFIType.pointer, FFIType.cstring],
    returns: FFIType.void,
  },
  webkit_web_view_get_inspector: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  webkit_web_inspector_show: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (inspector) -> void; closes the inspector window.
  webkit_web_inspector_close: {
    args: [FFIType.pointer],
    returns: FFIType.void,
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
  webkit_user_script_new_for_world: {
    args: [
      FFIType.cstring,
      FFIType.i32,
      FFIType.i32,
      FFIType.cstring,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.pointer,
  },
  // () -> WebKitWebContext* (the process-wide default context; transfer-none).
  webkit_web_context_get_default: {
    args: [],
    returns: FFIType.pointer,
  },
  // (WebKitWebView*) -> WebKitWebContext* (the view's context; transfer-none).
  webkit_web_view_get_context: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (context, scheme, callback, user_data, destroy_notify) -> void. The callback
  // is a `WebKitURISchemeRequestCallback`; user_data/destroy are NULL here.
  webkit_web_context_register_uri_scheme: {
    args: [FFIType.pointer, FFIType.cstring, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (WebKitURISchemeRequest*) -> const char* (transfer-none; owned by WebKit).
  webkit_uri_scheme_request_get_uri: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (request, GInputStream*, stream_length:gint64, content_type:char* /*nullable*/) -> void.
  // `finish` takes its own ref on the stream; -1 length = unknown.
  webkit_uri_scheme_request_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.i64, FFIType.pointer],
    returns: FFIType.void,
  },
  // (request, GError*) -> void. Completes the request with an error response.
  webkit_uri_scheme_request_finish_error: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
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
