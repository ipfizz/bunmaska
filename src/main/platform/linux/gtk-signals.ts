import { CString, JSCallback, type Pointer, read } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import type { NativeNavigationEvent } from '../native';
import { cstr } from '../cstr';
import { loadGlibFFI } from './glib-ffi';
import { G_CONNECT_DEFAULT, loadGObjectFFI } from './gobject-ffi';
import { loadJscFFI } from './jsc-ffi';
import {
  loadWebKitGtkFFI,
  WEBKIT_LOAD_COMMITTED,
  WEBKIT_LOAD_FINISHED,
  WEBKIT_LOAD_STARTED,
} from './webkitgtk-ffi';

const log = createLogger('gtk-signals');

/**
 * Wrap a signal handler so a JS throw is logged and `fallback` returned. An
 * exception left pending in a JSCallback silently skips every later callback in
 * the same `g_main_context_iteration` (URI-scheme requests, async completions).
 */
export const guarded =
  <A extends unknown[], R>(fn: (...args: A) => R, fallback: R) =>
  (...args: A): R => {
    try {
      return fn(...args);
    } catch (error) {
      log.error('signal handler threw', error);
      return fallback;
    }
  };

/** `GtkWindow::close-request`: `(self, user_data) -> gboolean`. */
export const CLOSE_REQUEST_CB_DEF = { args: ['ptr', 'ptr'], returns: 'i32' } as const;
/** `WebKitWebView::load-changed`: `(self, WebKitLoadEvent, user_data) -> void`. */
export const LOAD_CHANGED_CB_DEF = { args: ['ptr', 'i32', 'ptr'], returns: 'void' } as const;
/** `WebKitWebView::load-failed`: `(self, load_event, uri, GError*, user_data) -> gboolean`. */
export const LOAD_FAILED_CB_DEF = {
  args: ['ptr', 'i32', 'ptr', 'ptr', 'ptr'],
  returns: 'i32',
} as const;
/** `WebKitWebView::create`: `(self, navigation_action, user_data) -> GtkWidget*`. */
export const CREATE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'ptr' } as const;
/** `script-message-received` (WK6.0): `(manager, JSCValue*, user_data) -> void`. */
export const SCRIPT_MESSAGE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;
/** `GObject::notify`: `(gobject, pspec, user_data) -> void`. */
export const NOTIFY_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/**
 * `close-request` returns an INVERTED gboolean: 1 (TRUE) vetoes (GTK's default
 * handler does not run, the window stays), 0 lets GTK destroy the window.
 * `onCloseRequest` returns `true` to veto.
 */
export const closeRequestDecision = (onCloseRequest: () => boolean): number =>
  onCloseRequest() ? 1 : 0;

/** Native (title-bar) close; `onCloseRequest` runs teardown itself when it does not veto. */
export const makeCloseRequestCallback = (onCloseRequest: () => boolean): JSCallback =>
  new JSCallback(
    guarded(
      (_self: Pointer, _userData: Pointer): number => closeRequestDecision(onCloseRequest),
      0,
    ),
    CLOSE_REQUEST_CB_DEF,
  );

/** `notify::<prop>` handler; `onNotify` reads the new value through the widget's getter. */
export const makeNotifyCallback = (onNotify: () => void): JSCallback =>
  new JSCallback(
    guarded((_gobject: Pointer, _pspec: Pointer, _userData: Pointer): void => {
      onNotify();
    }, undefined),
    NOTIFY_CB_DEF,
  );

/**
 * `load-changed` + `load-failed` handlers sharing one failed flag: WebKitGTK always
 * emits `load-changed` FINISHED right after `load-failed`, and that FINISHED must
 * not report `did-finish-load`. `load-failed` returns 0 so WebKit shows its error page.
 */
export const makeLoadCallbacks = (
  onNavigation: (event: NativeNavigationEvent) => void,
): { readonly changed: JSCallback; readonly failed: JSCallback } => {
  let failed = false;
  const changed = new JSCallback(
    guarded((_self: Pointer, loadEvent: number, _userData: Pointer): void => {
      if (loadEvent === WEBKIT_LOAD_STARTED) {
        failed = false;
        onNavigation({ type: 'did-start-loading' });
      } else if (loadEvent === WEBKIT_LOAD_COMMITTED) {
        onNavigation({ type: 'did-navigate' });
      } else if (loadEvent === WEBKIT_LOAD_FINISHED && !failed) {
        onNavigation({ type: 'did-finish-load' });
        onNavigation({ type: 'did-stop-loading' });
      }
    }, undefined),
    LOAD_CHANGED_CB_DEF,
  );
  const failedCallback = new JSCallback(
    guarded(
      (
        _self: Pointer,
        _loadEvent: number,
        _uri: Pointer,
        error: Pointer | null,
        _userData: Pointer,
      ): number => {
        failed = true;
        // GError { GQuark domain @0; gint code @4; gchar *message @8 }.
        const message = error === null ? 0 : read.ptr(error, 8);
        onNavigation({
          type: 'did-fail-load',
          errorCode: error === null ? -1 : read.i32(error, 4),
          errorDescription: message === 0 ? '' : new CString(message as Pointer).toString(),
        });
        onNavigation({ type: 'did-stop-loading' });
        return 0;
      },
      0,
    ),
    LOAD_FAILED_CB_DEF,
  );
  return { changed, failed: failedCallback };
};

/** `window.open` / `target=_blank`: report the URL and return NULL, so no child view is created. */
export const makeCreateCallback = (onWindowOpen: (url: string) => void): JSCallback => {
  const webkit = loadWebKitGtkFFI();
  return new JSCallback(
    guarded((_webView: Pointer, navigationAction: Pointer, _userData: Pointer): Pointer | null => {
      const request = webkit.symbols.webkit_navigation_action_get_request(navigationAction);
      if (request !== null) {
        const uri = webkit.symbols.webkit_uri_request_get_uri(request);
        if (uri !== null) {
          onWindowOpen(new CString(uri).toString());
        }
      }
      return null;
    }, null),
    CREATE_CB_DEF,
  );
};

/**
 * WK6.0 passes a `JSCValue*` directly; never call the 4.x
 * `webkit_javascript_result_get_js_value` on it (crashes). `jsc_value_to_string`
 * is transfer-full, so every message must `g_free` it.
 */
export const makeScriptMessageCallback = (onMessage: (json: string) => void): JSCallback => {
  const jsc = loadJscFFI();
  const glib = loadGlibFFI();
  return new JSCallback(
    guarded((_manager: Pointer, value: Pointer, _userData: Pointer): void => {
      const ptr = jsc.symbols.jsc_value_to_string(value);
      // A NULL conversion would deliver an unparseable '' to the IPC layer; drop it.
      if (ptr === null) {
        return;
      }
      const json = new CString(ptr).toString();
      glib.symbols.g_free(ptr);
      onMessage(json);
    }, undefined),
    SCRIPT_MESSAGE_CB_DEF,
  );
};

/** Anything with a native trampoline that must be freed off the current stack. */
type Closable = { close: () => void };

/**
 * Close native trampolines on a LATER tick, never synchronously. This is the one
 * statement of the rule (D022b): closing a {@link JSCallback} while native code is
 * still inside its invocation frees the trampoline it returns into (SIGSEGV).
 * Disconnecting a handler is safe synchronously; only `.close()` is deferred.
 */
export const deferCallbackClose = (
  callbacks: readonly Closable[],
  schedule: (fn: () => void) => void = (fn) => {
    setTimeout(fn, 0);
  },
): void => {
  if (callbacks.length === 0) {
    return;
  }
  const pending = [...callbacks];
  schedule(() => {
    for (const cb of pending) {
      cb.close();
    }
  });
};

/** A live signal connection: its handler id and the retained callback thunk. */
export type SignalConnection = {
  readonly handlerId: bigint;
  readonly callback: JSCallback;
};

/**
 * Connect via `g_signal_connect_data`. The caller MUST keep `callback` reachable
 * while connected: a GC'd thunk turns the next emission into a jump into freed memory.
 */
export const connectSignal = (
  instance: Pointer,
  detailedSignal: string,
  callback: JSCallback,
): SignalConnection => {
  const gobject = loadGObjectFFI();
  const handlerId = gobject.symbols.g_signal_connect_data(
    instance,
    cstr(detailedSignal),
    callback.ptr,
    null,
    null,
    G_CONNECT_DEFAULT,
  );
  return { handlerId, callback };
};

/** Retains every thunk connected to one window's or web view's GObjects until teardown. */
export class SignalRegistry {
  readonly #connections: Array<{ instance: Pointer; connection: SignalConnection }> = [];

  connect(instance: Pointer, detailedSignal: string, callback: JSCallback): SignalConnection {
    const connection = connectSignal(instance, detailedSignal, callback);
    this.#connections.push({ instance, connection });
    return connection;
  }

  /** Idempotent, and safe inside a handler's own invocation (closes via {@link deferCallbackClose}). */
  disconnectAll(): void {
    if (this.#connections.length === 0) {
      return;
    }
    const gobject = loadGObjectFFI();
    const callbacks: JSCallback[] = [];
    for (const { instance, connection } of this.#connections) {
      gobject.symbols.g_signal_handler_disconnect(instance, connection.handlerId);
      callbacks.push(connection.callback);
    }
    this.#connections.length = 0;
    deferCallbackClose(callbacks);
  }
}
