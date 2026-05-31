import { CString, JSCallback, type Pointer } from 'bun:ffi';
import { cstr } from '../cstr';
import { loadGlibFFI } from './glib-ffi';
import { G_CONNECT_DEFAULT, loadGObjectFFI } from './gobject-ffi';
import { loadJscFFI } from './jsc-ffi';
import { WEBKIT_LOAD_FINISHED } from './webkitgtk-ffi';

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
/** ABI shape for `script-message-received` (WK6.0): `(manager, value, user_data) -> void`. */
export const SCRIPT_MESSAGE_CB_DEF = { args: ['ptr', 'ptr', 'ptr'], returns: 'void' } as const;

/**
 * `GtkWindow::close-request` handler.
 *
 * INVERTED semantics — return 0 (FALSE) to ALLOW the close so GTK's default
 * handler destroys the window; returning 1 vetoes. Fires `onClosed` bookkeeping
 * then returns 0.
 */
export const makeCloseRequestCallback = (onClosed: () => void): JSCallback =>
  new JSCallback((_self: Pointer, _userData: Pointer): number => {
    onClosed();
    return 0;
  }, CLOSE_REQUEST_CB_DEF);

/**
 * `GtkWidget::destroy` handler. Fires `onClosed` bookkeeping + drops retained
 * refs; performs no further GTK calls on self.
 */
export const makeDestroyCallback = (onClosed: () => void): JSCallback =>
  new JSCallback((_self: Pointer, _userData: Pointer): void => {
    onClosed();
  }, DESTROY_CB_DEF);

/**
 * `WebKitWebView::load-changed` handler. Fires `onDidFinishLoad` when
 * `load_event === WEBKIT_LOAD_FINISHED` (3).
 */
export const makeLoadChangedCallback = (onDidFinishLoad: () => void): JSCallback =>
  new JSCallback((_self: Pointer, loadEvent: number, _userData: Pointer): void => {
    if (loadEvent === WEBKIT_LOAD_FINISHED) {
      onDidFinishLoad();
    }
  }, LOAD_CHANGED_CB_DEF);

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
