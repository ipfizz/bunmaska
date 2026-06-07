import type { Pointer } from 'bun:ffi';
import { cstr } from '../cstr';
import { DOM_READY_HANDLER_NAME, generateDomReadyScript } from '../dom-ready';
import { loadGObjectFFI } from './gobject-ffi';
import { makeScriptMessageCallback, SignalRegistry } from './gtk-signals';
import {
  loadWebKitGtkFFI,
  WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
  WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
} from './webkitgtk-ffi';

/**
 * Name of the isolated JS world the bridge + user preload run in (Electron
 * `contextIsolation: true`). The page/main world is `NULL`. Must match the
 * macOS `PRELOAD_WORLD_NAME`.
 */
export const PRELOAD_WORLD_NAME = 'SambarPreload';

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

/**
 * Page-world handler name `executeJavaScript` posts its result to. Mirrors the
 * macOS `EXEC_RESULT_HANDLER_NAME` — the return channel for the public
 * `executeJavaScript`, registered in the PAGE world (world_name = NULL).
 */
export const EXEC_HANDLER_NAME = 'sambarExec';
/** The detailed signal connected before registering the exec handler. */
export const EXEC_SIGNAL = `script-message-received::${EXEC_HANDLER_NAME}`;

/** A web view wired for IPC, plus the manager and the signal registry to retain. */
export type WiredWebView = {
  readonly view: Pointer;
  readonly ucm: Pointer;
  readonly registry: SignalRegistry;
};

/** Options for {@link createWebViewWithIpc}. */
export type WebViewIpcOptions = {
  /** The preload bridge source injected at document-start in the isolated world. */
  readonly preloadSource: string;
  /**
   * Optional user preload source injected at document-start in the isolated
   * world AFTER the bridge + contextBridge host, so `window.__sambar` and
   * `exposeInMainWorld` exist when it runs.
   */
  readonly userPreloadSource?: string;
  /**
   * Source injected into the ISOLATED world BEFORE the bridge (e.g. the
   * contextBridge channel-id setup). Optional.
   */
  readonly isolatedSetupSource?: string;
  /**
   * The contextBridge host source injected into the ISOLATED world AFTER the
   * bridge and BEFORE the user preload — it installs
   * `window.__sambar.exposeInMainWorld`. Optional.
   */
  readonly isolatedHostSource?: string;
  /**
   * Source injected into the PAGE/main world (world_name = NULL) — the
   * cross-world contextBridge stub (Phase B). Optional.
   */
  readonly pageWorldSource?: string;
  /** Called with each JSON envelope the renderer posts. */
  readonly onMessage: (json: string) => void;
  /**
   * Called with each JSON `{ execId, ok, result?, error? }` the page-world
   * `executeJavaScript` wrapper posts to the `sambarExec` handler. Optional.
   */
  readonly onExecMessage?: (json: string) => void;
  /** Called when the page-world dom-ready script fires (DOMContentLoaded). Optional. */
  readonly onDomReady?: () => void;
};

/** Assert a native call returned a real (non-NULL) pointer. */
const requirePointer = (ptr: Pointer | null, what: string): Pointer => {
  if (ptr === null) {
    throw new Error(`WebKitGTK returned a NULL pointer for ${what}`);
  }
  return ptr;
};

/**
 * Build a `WebKitUserScript` from `source` for the named isolated world and add
 * it to the manager at document-start in all frames. The manager takes its own
 * ref on the script, so it need not be retained here.
 */
const addUserScript = (ucm: Pointer, source: string): void => {
  const webkit = loadWebKitGtkFFI();
  const script = webkit.symbols.webkit_user_script_new_for_world(
    cstr(source),
    WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
    WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
    cstr(PRELOAD_WORLD_NAME),
    null,
    null,
  );
  webkit.symbols.webkit_user_content_manager_add_script(ucm, requirePointer(script, 'user_script'));
};

/**
 * Build a `WebKitUserScript` from `source` for the PAGE/main world (world_name =
 * NULL) and add it at document-start in all frames — the Phase B cross-world
 * stub injection path.
 */
const addPageWorldScript = (ucm: Pointer, source: string): void => {
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
 * 3. `register_script_message_handler(ucm, 'sambar', 'SambarPreload')` (isolated world)
 * 4. add the preload user-script at document-start in all frames (isolated world)
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

  // Register the handler IN the isolated world so its `webkit.messageHandlers`
  // binding is reachable only from there (matches the user-script world below).
  webkit.symbols.webkit_user_content_manager_register_script_message_handler(
    ucm,
    cstr(HANDLER_NAME),
    cstr(PRELOAD_WORLD_NAME),
  );

  // Second handler in the PAGE world (world_name = NULL): the return channel for
  // the public `executeJavaScript`, whose wrapper posts its result here. Its
  // JSCallback is retained in the SAME registry so it is closed on window
  // teardown — NEVER per-call (closing a JSCallback mid-invocation frees its
  // native trampoline). Connect the detailed signal BEFORE registering (race).
  if (options.onExecMessage !== undefined) {
    const execCallback = makeScriptMessageCallback(options.onExecMessage);
    registry.connect(ucm, EXEC_SIGNAL, execCallback);
    webkit.symbols.webkit_user_content_manager_register_script_message_handler(
      ucm,
      cstr(EXEC_HANDLER_NAME),
      null,
    );
  }

  // Page-world dom-ready handler: the injected script posts here on
  // DOMContentLoaded. Same retain/connect-before-register discipline as exec.
  if (options.onDomReady !== undefined) {
    const onDomReady = options.onDomReady;
    const domReadyCallback = makeScriptMessageCallback(() => onDomReady());
    registry.connect(ucm, `script-message-received::${DOM_READY_HANDLER_NAME}`, domReadyCallback);
    webkit.symbols.webkit_user_content_manager_register_script_message_handler(
      ucm,
      cstr(DOM_READY_HANDLER_NAME),
      null,
    );
  }

  // Isolated world: channel-id setup (if any) BEFORE the bridge, then the
  // bridge, then the contextBridge host (installs exposeInMainWorld), then the
  // user preload (so it can call exposeInMainWorld).
  if (options.isolatedSetupSource !== undefined) {
    addUserScript(ucm, options.isolatedSetupSource);
  }
  addUserScript(ucm, options.preloadSource);
  if (options.isolatedHostSource !== undefined) {
    addUserScript(ucm, options.isolatedHostSource);
  }
  if (options.userPreloadSource !== undefined) {
    addUserScript(ucm, options.userPreloadSource);
  }
  // Page/main world: the cross-world contextBridge stub (Phase B).
  if (options.pageWorldSource !== undefined) {
    addPageWorldScript(ucm, options.pageWorldSource);
  }
  // Page/main world: the dom-ready notifier (posts on DOMContentLoaded).
  if (options.onDomReady !== undefined) {
    addPageWorldScript(ucm, generateDomReadyScript());
  }

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
 * `evaluate_javascript` (length = -1 for NUL-terminated; cancellable/callback/
 * user_data are NULL). `world_name` targets the ISOLATED `SambarPreload` world,
 * where `__sambar._dispatch` lives — NOT the page world.
 */
export const sendToRenderer = (view: Pointer, envelopeJson: string): void => {
  const webkit = loadWebKitGtkFFI();
  webkit.symbols.webkit_web_view_evaluate_javascript(
    view,
    cstr(buildDispatchScript(envelopeJson)),
    -1n,
    cstr(PRELOAD_WORLD_NAME),
    null,
    null,
    null,
    null,
  );
};

/**
 * Evaluate `source` in the PAGE/main world (world_name = NULL) fire-and-forget —
 * NO `GAsyncReadyCallback` (length = -1 for NUL-terminated; cancellable/callback/
 * user_data are NULL). Used to inject the `executeJavaScript` wrapper, whose
 * result returns out-of-band via the `sambarExec` page-world handler.
 */
export const evalInPageWorld = (view: Pointer, source: string): void => {
  const webkit = loadWebKitGtkFFI();
  webkit.symbols.webkit_web_view_evaluate_javascript(
    view,
    cstr(source),
    -1n,
    null,
    null,
    null,
    null,
    null,
  );
};
