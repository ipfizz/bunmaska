import type { Pointer } from 'bun:ffi';
import { cstr } from '../cstr';
import { DOM_READY_HANDLER_NAME, generateDomReadyScript } from '../dom-ready';
import { EXEC_HANDLER_NAME } from '../exec-result-channel';
import { loadGObjectFFI } from './gobject-ffi';
import { makeScriptMessageCallback, SignalRegistry } from './gtk-signals';
import {
  loadWebKitGtkFFI,
  WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
  WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
} from './webkitgtk-ffi';

/** The isolated world (Electron `contextIsolation`) the bridge and preloads run in. */
export const PRELOAD_WORLD_NAME = 'BunmaskaPreload';

/** The isolated-world handler the preload bridge posts envelopes to. */
export const HANDLER_NAME = 'bunmaska';
export const SIGNAL = `script-message-received::${HANDLER_NAME}`;

export const EXEC_SIGNAL = `script-message-received::${EXEC_HANDLER_NAME}`;

/** A web view wired for IPC, plus the manager and the signal registry to retain. */
export type WiredWebView = {
  readonly view: Pointer;
  readonly ucm: Pointer;
  readonly registry: SignalRegistry;
};

export type WebViewIpcOptions = {
  readonly preloadSource: string;
  readonly userPreloadSource?: string;
  readonly isolatedSetupSource: string;
  readonly isolatedHostSource: string;
  readonly pageWorldSource: string;
  readonly onMessage: (json: string) => void;
  /** Receives each `{ execId, ok, result?, error? }` JSON the exec wrapper posts. */
  readonly onExecMessage: (json: string) => void;
  readonly onDomReady: () => void;
};

const requirePointer = (ptr: Pointer | null, what: string): Pointer => {
  if (ptr === null) {
    throw new Error(`WebKitGTK returned a NULL pointer for ${what}`);
  }
  return ptr;
};

/** Add `source` to the isolated `BunmaskaPreload` world at document-start. */
const addUserScript = (ucm: Pointer, source: string): void => {
  const webkit = loadWebKitGtkFFI();
  const script = requirePointer(
    webkit.symbols.webkit_user_script_new_for_world(
      cstr(source),
      WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
      WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
      cstr(PRELOAD_WORLD_NAME),
      null,
      null,
    ),
    'user_script',
  );
  webkit.symbols.webkit_user_content_manager_add_script(ucm, script);
  webkit.symbols.webkit_user_script_unref(script);
};

const addPageWorldScript = (ucm: Pointer, source: string): void => {
  const webkit = loadWebKitGtkFFI();
  const script = requirePointer(
    webkit.symbols.webkit_user_script_new(
      cstr(source),
      WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
      WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
      null,
      null,
    ),
    'user_script',
  );
  webkit.symbols.webkit_user_content_manager_add_script(ucm, script);
  webkit.symbols.webkit_user_script_unref(script);
};

/**
 * The user-content-manager is construct-only, so it is fully wired before
 * `g_object_new`, whose varargs MUST end in a real NULL. Each
 * `script-message-received::` signal is connected BEFORE its handler is
 * registered (documented race).
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

  // Isolated world only: page scripts must never reach the `bunmaska` handler.
  webkit.symbols.webkit_user_content_manager_register_script_message_handler(
    ucm,
    cstr(HANDLER_NAME),
    cstr(PRELOAD_WORLD_NAME),
  );

  registry.connect(ucm, EXEC_SIGNAL, makeScriptMessageCallback(options.onExecMessage));
  webkit.symbols.webkit_user_content_manager_register_script_message_handler(
    ucm,
    cstr(EXEC_HANDLER_NAME),
    null,
  );

  registry.connect(
    ucm,
    `script-message-received::${DOM_READY_HANDLER_NAME}`,
    makeScriptMessageCallback(() => options.onDomReady()),
  );
  // Isolated world: WebKitGTK names no posting frame, and any iframe reaches a page-world handler.
  webkit.symbols.webkit_user_content_manager_register_script_message_handler(
    ucm,
    cstr(DOM_READY_HANDLER_NAME),
    cstr(PRELOAD_WORLD_NAME),
  );

  // Order matters: channel setup, bridge, contextBridge host (installs
  // exposeInMainWorld), then the user preload that calls it.
  addUserScript(ucm, options.isolatedSetupSource);
  addUserScript(ucm, options.preloadSource);
  addUserScript(ucm, options.isolatedHostSource);
  if (options.userPreloadSource !== undefined) {
    addUserScript(ucm, options.userPreloadSource);
  }
  addUserScript(ucm, generateDomReadyScript());
  addPageWorldScript(ucm, options.pageWorldSource);

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

/** A no-op until the isolated-world bridge exists. */
export const buildDispatchScript = (envelopeJson: string): string =>
  `window.__bunmaska && window.__bunmaska._dispatch(${JSON.stringify(envelopeJson)});`;

/** Fire-and-forget into the ISOLATED world, where `__bunmaska._dispatch` lives (not the page world). */
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

/** Fire-and-forget into the page world (world_name NULL); used for the exec wrapper. */
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
