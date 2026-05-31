import type { Pointer } from 'bun:ffi';
import { cstr } from '../cstr';
import { loadGObjectFFI } from './gobject-ffi';
import { makeScriptMessageCallback, SignalRegistry } from './gtk-signals';
import {
  loadWebKitGtkFFI,
  WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
  WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
} from './webkitgtk-ffi';

/**
 * WebKitGTK 6.0 IPC bridge — the Linux mirror of `cocoa-script-message-handler`.
 *
 * Builds a fully-wired `WebKitUserContentManager` BEFORE the view is
 * constructed, then constructs the view with that manager as a construct-only
 * property. The renderer posts envelopes via
 * `window.webkit.messageHandlers.sambar.postMessage(json)`; the main process
 * pushes envelopes back via `evaluate_javascript` calling
 * `window.__sambar._dispatch(...)` (fire-and-forget, D022).
 */

/** The script-message handler name the preload bridge posts to. */
export const HANDLER_NAME = 'sambar';
/** The detailed signal connected before registering the handler (documented race). */
export const SIGNAL = `script-message-received::${HANDLER_NAME}`;

/** A web view wired for IPC, plus the manager and the signal registry to retain. */
export type WiredWebView = {
  readonly view: Pointer;
  readonly ucm: Pointer;
  readonly registry: SignalRegistry;
};

/** Options for {@link createWebViewWithIpc}. */
export type WebViewIpcOptions = {
  /** The preload bridge source injected at document-start in all frames. */
  readonly preloadSource: string;
  /** Called with each JSON envelope the renderer posts. */
  readonly onMessage: (json: string) => void;
};

/** Assert a native call returned a real (non-NULL) pointer. */
const requirePointer = (ptr: Pointer | null, what: string): Pointer => {
  if (ptr === null) {
    throw new Error(`WebKitGTK returned a NULL pointer for ${what}`);
  }
  return ptr;
};

/**
 * Build a `WebKitUserScript` for the preload bridge and add it to the manager.
 * The manager takes its own ref on the script, so it need not be retained here.
 */
const addPreloadUserScript = (ucm: Pointer, source: string): void => {
  const webkit = loadWebKitGtkFFI();
  const script = webkit.symbols.webkit_user_script_new(
    cstr(source),
    WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
    WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
    null,
    null,
  );
  webkit.symbols.webkit_user_content_manager_add_script(ucm, requirePointer(script, 'user_script'));
};

/**
 * Create a `WebKitWebView` with a pre-wired user-content-manager:
 * 1. `webkit_user_content_manager_new()`
 * 2. connect `script-message-received::sambar` BEFORE register (documented race)
 * 3. `register_script_message_handler(ucm, 'sambar', NULL)` (default world)
 * 4. add the preload user-script at document-start in all frames
 * 5. construct the view via `g_object_new(webkit_web_view_get_type(),
 *    'user-content-manager', ucm, NULL)` — the manager is construct-only.
 *
 * The trailing `g_object_new` arg MUST be a true null terminator (0).
 */
export const createWebViewWithIpc = (options: WebViewIpcOptions): WiredWebView => {
  const webkit = loadWebKitGtkFFI();
  const gobject = loadGObjectFFI();
  const registry = new SignalRegistry();

  const ucm = requirePointer(
    webkit.symbols.webkit_user_content_manager_new(),
    'user_content_manager',
  );

  const callback = makeScriptMessageCallback(options.onMessage);
  registry.connect(ucm, SIGNAL, callback);

  // world_name = NULL (default world). cstring cannot encode NULL -> pointer 0.
  webkit.symbols.webkit_user_content_manager_register_script_message_handler(
    ucm,
    cstr(HANDLER_NAME),
    null,
  );

  addPreloadUserScript(ucm, options.preloadSource);

  const view = requirePointer(
    gobject.symbols.g_object_new(
      webkit.symbols.webkit_web_view_get_type(),
      cstr('user-content-manager'),
      ucm,
      null,
    ),
    'web_view',
  );

  return { view, ucm, registry };
};

/**
 * Escape a JSON envelope string as a JS string literal so it can be embedded in
 * the `window.__sambar._dispatch(...)` call passed to `evaluate_javascript`.
 */
export const buildDispatchScript = (envelopeJson: string): string =>
  `window.__sambar && window.__sambar._dispatch(${JSON.stringify(envelopeJson)});`;

/**
 * Push a JSON envelope to the renderer's preload bridge via fire-and-forget
 * `evaluate_javascript` (length = -1 for NUL-terminated; all trailing
 * world/source/cancellable/callback/user_data are NULL).
 */
export const sendToRenderer = (view: Pointer, envelopeJson: string): void => {
  const webkit = loadWebKitGtkFFI();
  webkit.symbols.webkit_web_view_evaluate_javascript(
    view,
    cstr(buildDispatchScript(envelopeJson)),
    -1n,
    null,
    null,
    null,
    null,
    null,
  );
};
