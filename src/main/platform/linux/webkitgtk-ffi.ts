import { CString, FFIType, type Pointer } from 'bun:ffi';
import { UnsupportedPlatformError } from '../../../common/errors';
import { currentPlatform } from '../../../common/platform';
import { dlopenLinux } from './glib-ffi';

const LIBWEBKITGTK_PATH = 'libwebkitgtk-6.0.so.4';

/** `WebKitLoadEvent`: STARTED=0, REDIRECTED=1, COMMITTED=2, FINISHED=3. */
export const WEBKIT_LOAD_STARTED = 0;
export const WEBKIT_LOAD_COMMITTED = 2;
export const WEBKIT_LOAD_FINISHED = 3;
/** `WebKitUserContentInjectedFrames`: never subframes, or a third-party iframe gets every exposed API. */
export const WEBKIT_USER_CONTENT_INJECT_TOP_FRAME = 1;
/** `WebKitUserScriptInjectionTime`: inject the preload at document start. */
export const WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START = 0;
/** `WebKitSnapshotRegion`: the visible viewport (Electron `capturePage` semantics), not FULL_DOCUMENT (1). */
export const WEBKIT_SNAPSHOT_REGION_VISIBLE = 0;
/** `WebKitSnapshotOptions`: no selection highlight, opaque background. */
export const WEBKIT_SNAPSHOT_OPTIONS_NONE = 0;

export const WEBKITGTK_FFI_SYMBOLS = {
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
  webkit_web_view_stop_loading: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // (web_view) -> const gchar* title (BORROWED - do NOT free; NULL when none).
  webkit_web_view_get_title: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (web_view, command /*e.g. "Copy","Paste","SelectAll"*/) -> void; queued, non-blocking.
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
  // WK6.0 8-arg form: (view, script, length:i64 /*-1 = NUL-terminated*/, world_name, source_uri,
  //  cancellable, callback, user_data); null trailing pointers = fire-and-forget (D022).
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
  webkit_web_view_get_settings: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  webkit_settings_set_enable_developer_extras: {
    args: [FFIType.pointer, FFIType.i32],
    returns: FFIType.void,
  },
  // (settings, user_agent /*null resets to default*/) -> void
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
  webkit_web_inspector_close: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  webkit_user_content_manager_new: {
    args: [],
    returns: FFIType.pointer,
  },
  // WK6.0 3-arg form: (manager, name, world_name /*null = default world*/) -> gboolean.
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
  // add_script retains the underlying script, so the caller's ref is dropped right after it.
  webkit_user_script_unref: {
    args: [FFIType.pointer],
    returns: FFIType.void,
  },
  // () -> WebKitWebContext* (transfer-none).
  webkit_web_context_get_default: {
    args: [],
    returns: FFIType.pointer,
  },
  // (WebKitWebView*) -> WebKitWebContext* (transfer-none).
  webkit_web_view_get_context: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (context, scheme, WebKitURISchemeRequestCallback, user_data, destroy_notify) -> void.
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
  // (request, GError*) -> void.
  webkit_uri_scheme_request_finish_error: {
    args: [FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // () -> WebKitNetworkSession* (transfer-none).
  webkit_network_session_get_default: {
    args: [],
    returns: FFIType.pointer,
  },
  // (WebKitNetworkSession*) -> WebKitCookieManager* (transfer-none).
  webkit_network_session_get_cookie_manager: {
    args: [FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (manager, cancellable /*null*/, GAsyncReadyCallback, user_data /*null*/) -> void.
  // WebKitGTK 2.42+, and Bun resolves the whole table at dlopen: this sets the backend's floor.
  webkit_cookie_manager_get_all_cookies: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (manager, GAsyncResult*, GError** /*null ok*/) -> GList* of SoupCookie*
  // (transfer-FULL: soup_cookie_free each node's data, then g_list_free the list).
  webkit_cookie_manager_get_all_cookies_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
  // (manager, SoupCookie* /*NOT consumed - caller frees after the finish*/,
  //  cancellable /*null*/, GAsyncReadyCallback, user_data /*null*/) -> void.
  webkit_cookie_manager_add_cookie: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  // (manager, GAsyncResult*, GError** /*null ok*/) -> gboolean (i32).
  webkit_cookie_manager_add_cookie_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  // Same shape as add_cookie; matches on the cookie's name+domain+path.
  webkit_cookie_manager_delete_cookie: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.void,
  },
  webkit_cookie_manager_delete_cookie_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.i32,
  },
  // (view, region:WebKitSnapshotRegion /*i32 enum, VISIBLE=0*/, options /*i32 flags, NONE=0*/,
  //  cancellable /*null*/, GAsyncReadyCallback, user_data /*null*/) -> void.
  webkit_web_view_get_snapshot: {
    args: [
      FFIType.pointer,
      FFIType.i32,
      FFIType.i32,
      FFIType.pointer,
      FFIType.pointer,
      FFIType.pointer,
    ],
    returns: FFIType.void,
  },
  // (view, GAsyncResult*, GError** /*null ok*/) -> GdkTexture* (transfer-full: g_object_unref;
  // NULL on error). Never the 4.x cairo_surface_t*: cairo_surface_destroy on it aborts.
  webkit_web_view_get_snapshot_finish: {
    args: [FFIType.pointer, FFIType.pointer, FFIType.pointer],
    returns: FFIType.pointer,
  },
} as const;

const cache: { ffi: ReturnType<typeof dlopenLinux<typeof WEBKITGTK_FFI_SYMBOLS>> | undefined } = {
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
  const ffi = dlopenLinux(LIBWEBKITGTK_PATH, WEBKITGTK_FFI_SYMBOLS);
  cache.ffi = ffi;
  return ffi;
};

/** Decode `webkit_web_view_get_uri`'s borrowed string; NULL before the first load reads as `''`. */
export const readGetUriResult = (ptr: Pointer | null): string =>
  ptr === null ? '' : new CString(ptr).toString();
