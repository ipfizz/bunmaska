import { CString, JSCallback, type Pointer } from 'bun:ffi';
import type { NativeNavigationEvent } from '../native';
import { cstr } from '../cstr';
import { loadGlibFFI } from './glib-ffi';
import { G_CONNECT_DEFAULT, loadGObjectFFI } from './gobject-ffi';
import { loadJscFFI } from './jsc-ffi';
import { WEBKIT_LOAD_COMMITTED, WEBKIT_LOAD_FINISHED, WEBKIT_LOAD_STARTED } from './webkitgtk-ffi';

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
 * Mirrors the macOS `cocoa-runtime-class.ts` / `cocoa-navigation-delegate.ts`
 * JSCallback retain-to-avoid-GC pattern.
 *
 * Bun's {@link JSCallback} does not expose its `{ args, returns }` definition at
 * runtime, so each handler's ABI shape is declared as an exported `*_CB_DEF`
 * constant (unit-testable in pure JS) and reused by the factory below.
 */

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
/** ABI shape for `script-message-received` (WK6.0): `(manager, value, user_data) -> void`. */
export const SCRIPT_MESSAGE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;
/** ABI shape for a `GObject::notify` signal: `(gobject, pspec, user_data) -> void`. */
export const NOTIFY_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/**
 * Decide a `GtkWindow::close-request` return value from a JS close handler.
 *
 * INVERTED GTK semantics: return 1 (TRUE) to VETO (stop the default handler, so
 * the window stays open); return 0 (FALSE) to ALLOW GTK's default handler to
 * destroy the window. `onCloseRequest` returns `true` to veto. Pure (no FFI) so
 * the veto logic is unit-tested without a display.
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
    (_self: Pointer, _userData: Pointer): number => closeRequestDecision(onCloseRequest),
    CLOSE_REQUEST_CB_DEF,
  );

/**
 * A generic `GObject::notify::<prop>` handler. Runs `onNotify` on each property
 * change; the caller reads the new value (e.g. via `g_object_get`) or toggles a
 * tracked flag. The `GParamSpec*` second arg is ignored.
 */
export const makeNotifyCallback = (onNotify: () => void): JSCallback =>
  new JSCallback((_gobject: Pointer, _pspec: Pointer, _userData: Pointer): void => {
    onNotify();
  }, NOTIFY_CB_DEF);

/**
 * `GtkWidget::destroy` handler. Fires `onClosed` bookkeeping + drops retained
 * refs; performs no further GTK calls on self.
 */
export const makeDestroyCallback = (onClosed: () => void): JSCallback =>
  new JSCallback((_self: Pointer, _userData: Pointer): void => {
    onClosed();
  }, DESTROY_CB_DEF);

/**
 * `WebKitWebView::load-changed` handler. Maps the GTK load phases to navigation
 * events: STARTED → `did-start-loading`, COMMITTED → `did-navigate`, FINISHED →
 * `did-finish-load` then `did-stop-loading`.
 */
export const makeLoadChangedCallback = (
  onNavigation: (event: NativeNavigationEvent) => void,
): JSCallback =>
  new JSCallback((_self: Pointer, loadEvent: number, _userData: Pointer): void => {
    if (loadEvent === WEBKIT_LOAD_STARTED) {
      onNavigation({ type: 'did-start-loading' });
    } else if (loadEvent === WEBKIT_LOAD_COMMITTED) {
      onNavigation({ type: 'did-navigate' });
    } else if (loadEvent === WEBKIT_LOAD_FINISHED) {
      onNavigation({ type: 'did-finish-load' });
      onNavigation({ type: 'did-stop-loading' });
    }
  }, LOAD_CHANGED_CB_DEF);

/**
 * `WebKitWebView::load-failed` handler. Emits `did-fail-load` then
 * `did-stop-loading`. Returns 0 so WebKit still shows its default error page.
 * Error detail is not parsed from the `GError` yet (best-effort on Linux).
 */
export const makeLoadFailedCallback = (
  onNavigation: (event: NativeNavigationEvent) => void,
): JSCallback =>
  new JSCallback(
    (
      _self: Pointer,
      _loadEvent: number,
      _uri: Pointer,
      _error: Pointer,
      _userData: Pointer,
    ): number => {
      onNavigation({ type: 'did-fail-load', errorCode: -1, errorDescription: '' });
      onNavigation({ type: 'did-stop-loading' });
      return 0;
    },
    LOAD_FAILED_CB_DEF,
  );

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
  return new JSCallback((_manager: Pointer, value: Pointer, _userData: Pointer): void => {
    const ptr = jsc.symbols.jsc_value_to_string(value);
    // A NULL conversion would deliver an unparseable '' to the IPC layer; drop it.
    if (ptr === null) {
      return;
    }
    const json = new CString(ptr).toString();
    glib.symbols.g_free(ptr);
    onMessage(json);
  }, SCRIPT_MESSAGE_CB_DEF);
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

  /** Disconnect every handler then close its callback thunk. Idempotent. */
  disconnectAll(): void {
    if (this.#connections.length === 0) {
      return;
    }
    const gobject = loadGObjectFFI();
    for (const { instance, connection } of this.#connections) {
      gobject.symbols.g_signal_handler_disconnect(instance, connection.handlerId);
      connection.callback.close();
    }
    this.#connections.length = 0;
  }
}
