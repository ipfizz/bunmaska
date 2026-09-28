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

/**
 * GObject signal wiring for the Linux backend.
 *
 * Wraps `g_signal_connect_data` with {@link JSCallback} creation and lifetime
 * management. Every {@link JSCallback} handed to `g_signal_connect_data` MUST
 * stay reachable from JS for the life of the connection — if Bun GCs the native
 * thunk while GObject still holds the function pointer, the next signal emission
 * jumps into freed memory. The {@link SignalRegistry}, owned by each long-lived
 * `NativeWindow`/`NativeWebContents`, retains every callback to prevent that.
 *
 * Bun's {@link JSCallback} does not expose its `{ args, returns }` definition at
 * runtime, so each handler's ABI shape is declared as an exported `*_CB_DEF`
 * constant (unit-testable in pure JS) and reused by the factory below.
 */

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

/** ABI shape for `GtkWindow::close-request`: `(self, user_data) -> gboolean`. */
export const CLOSE_REQUEST_CB_DEF = { args: ['ptr', 'ptr'], returns: 'i32' } as const;
/** ABI shape for `GtkWidget::destroy`: `(self, user_data) -> void`. */
export const DESTROY_CB_DEF = { args: ['ptr', 'ptr'], returns: 'void' } as const;
/** ABI shape for `WebKitWebView::load-changed`: `(self, load_event, user_data) -> void`. */
export const LOAD_CHANGED_CB_DEF = { args: ['ptr', 'i32', 'ptr'], returns: 'void' } as const;
/** ABI shape for `WebKitWebView::load-failed`: `(self, load_event, uri, error, user_data) -> gboolean`. */
export const LOAD_FAILED_CB_DEF = {
  args: ['ptr', 'i32', 'ptr', 'ptr', 'ptr'],
  returns: 'i32',
} as const;
/** ABI shape for `WebKitWebView::create`: `(self, navigation_action, user_data) -> GtkWidget*`. */
export const CREATE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'ptr' } as const;
/** ABI shape for `script-message-received` (WK6.0): `(manager, value, user_data) -> void`. */
export const SCRIPT_MESSAGE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;
/** ABI shape for a `GObject::notify` signal: `(gobject, pspec, user_data) -> void`. */
export const NOTIFY_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/**
 * Decide a `GtkWindow::close-request` return value from a JS close handler.
 *
 * INVERTED GTK semantics: return 1 (TRUE) to VETO (stop the default handler, so
 * the window stays open); return 0 (FALSE) to ALLOW GTK's default handler to
 * destroy the window. `onCloseRequest` returns `true` to veto.
 */
export const closeRequestDecision = (onCloseRequest: () => boolean): number =>
  onCloseRequest() ? 1 : 0;

/**
 * `GtkWindow::close-request` handler (preventable).
 *
 * `onCloseRequest` is consulted on every close attempt (title-bar button or the
 * programmatic `gtk_window_close`). It returns `true` to VETO — the window stays
 * open and {@link closeRequestDecision} returns 1; otherwise it runs the close
 * bookkeeping/teardown itself and returns `false`, so this returns 0 and GTK
 * destroys the window.
 */
export const makeCloseRequestCallback = (onCloseRequest: () => boolean): JSCallback =>
  new JSCallback(
    guarded(
      (_self: Pointer, _userData: Pointer): number => closeRequestDecision(onCloseRequest),
      0,
    ),
    CLOSE_REQUEST_CB_DEF,
  );

/**
 * A generic `GObject::notify::<prop>` handler. Runs `onNotify` on each property
 * change; the caller reads the new value (e.g. via `g_object_get`) or toggles a
 * tracked flag. The `GParamSpec*` second arg is ignored.
 */
export const makeNotifyCallback = (onNotify: () => void): JSCallback =>
  new JSCallback(
    guarded((_gobject: Pointer, _pspec: Pointer, _userData: Pointer): void => {
      onNotify();
    }, undefined),
    NOTIFY_CB_DEF,
  );

/**
 * `GtkWidget::destroy` handler. Fires `onClosed` bookkeeping + drops retained
 * refs; performs no further GTK calls on self.
 */
export const makeDestroyCallback = (onClosed: () => void): JSCallback =>
  new JSCallback((_self: Pointer, _userData: Pointer): void => {
    onClosed();
  }, DESTROY_CB_DEF);

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

/**
 * `WebKitWebView::create` handler (`window.open` / `target=_blank`). Reads the
 * target URI from the navigation action, hands it to `onWindowOpen`, and returns
 * NULL so no child web view is created (v1 deny path).
 */
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
 * `WebKitUserContentManager::script-message-received` handler (WK6.0).
 *
 * In WK6.0 the second arg is a `JSCValue*` DIRECTLY (NOT a
 * `WebKitJavascriptResult*` — calling `webkit_javascript_result_get_js_value`
 * on it is the stale 4.x path and crashes). Convert via `jsc_value_to_string`
 * (transfer-full `char*`), read it, then `g_free` it to avoid leaking on every
 * message.
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
 * Close each callback's native trampoline on a LATER tick, never synchronously.
 * A signal handler runs on GTK's stack; closing its own {@link JSCallback} while
 * that stack is live frees the trampoline GTK is about to return into (SIGSEGV,
 * the D022b discipline). Disconnecting the handler is safe synchronously; only
 * the `.close()` is deferred. Empty batches schedule nothing.
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
 * Connect a {@link JSCallback} to a GObject signal via `g_signal_connect_data`.
 * The caller MUST retain the returned `callback` (see {@link SignalRegistry}).
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

/**
 * Retains every {@link JSCallback} connected to a long-lived GObject so Bun does
 * not GC the native thunk while the connection is live. Owned by each
 * `NativeWindow`/`NativeWebContents`. {@link disconnectAll} disconnects each
 * handler then closes its callback.
 */
export class SignalRegistry {
  readonly #connections: Array<{ instance: Pointer; connection: SignalConnection }> = [];

  /** Connect and retain in one step. */
  connect(instance: Pointer, detailedSignal: string, callback: JSCallback): SignalConnection {
    const connection = connectSignal(instance, detailedSignal, callback);
    this.#connections.push({ instance, connection });
    return connection;
  }

  /** The number of retained connections (for tests + teardown bookkeeping). */
  get size(): number {
    return this.#connections.length;
  }

  /**
   * Disconnect every handler synchronously (no more signals fire), then close
   * the callback thunks on a LATER tick via {@link deferCallbackClose} — safe to
   * call from inside a signal handler's own invocation (e.g. close-request).
   * Idempotent.
   */
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
