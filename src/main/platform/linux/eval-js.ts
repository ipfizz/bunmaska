import { CString, JSCallback, type Pointer, ptr, read } from 'bun:ffi';
import { cstr } from '../cstr';
import { loadGlibFFI } from './glib-ffi';
import { ASYNC_READY_CB_DEF } from './gtk-signals';
import { loadJscFFI } from './jsc-ffi';
import { loadWebKitGtkFFI } from './webkitgtk-ffi';

/**
 * `WebContents.executeJavaScript` on Linux (WebKitGTK 6.0).
 *
 * `webkit_web_view_evaluate_javascript` runs the script in the PAGE world
 * (world_name = NULL) and reports completion through a real
 * `GAsyncReadyCallback` — a plain C function pointer, safe with `bun:ffi`'s
 * {@link JSCallback} (NOT an Objective-C block, so no D022 hazard). On firing,
 * `evaluate_javascript_finish` yields the result `JSCValue*` (or NULL + GError).
 *
 * The result is serialized uniformly with `jsc_value_to_json` and JSON-parsed on
 * the JS side — so string/number/boolean/null/object/array all round-trip with
 * `JSON.stringify` semantics. The transfer-full JSON `char*` is freed with
 * `g_free`; a failure's GError is read for its message then freed.
 *
 * Each call creates one JSCallback, retained in a module registry against GC
 * until it fires, then closed. A 30s timeout rejects + frees the slot so a
 * navigated-away page cannot leak the Promise.
 */

/** Reject + clear a pending `executeJavaScript` after this long (ms). */
export const EVAL_TIMEOUT_MS = 30_000;

/** Byte offset of `message` in `GError { GQuark domain; gint code; gchar* message; }`. */
const GERROR_MESSAGE_OFFSET = 8;

/** Retains in-flight async callbacks so Bun cannot GC the native thunk pre-fire. */
const inFlight = new Set<JSCallback>();

/** Read a `GError**` slot's message string then free the GError. */
const takeGErrorMessage = (errorSlotPtr: Pointer): string => {
  const errAddr = read.ptr(errorSlotPtr, 0);
  if (errAddr === 0) {
    return 'executeJavaScript failed';
  }
  const errPtr = errAddr as Pointer;
  const messageAddr = read.ptr(errPtr, GERROR_MESSAGE_OFFSET);
  const message =
    messageAddr === 0 ? 'executeJavaScript failed' : new CString(messageAddr as Pointer).toString();
  loadGlibFFI().symbols.g_error_free(errPtr);
  return message;
};

/**
 * Evaluate `code` in `view`'s page world and resolve to its JSON-round-tripped
 * completion value (Electron semantics).
 */
export const evaluateJavaScriptOnView = (view: Pointer, code: string): Promise<unknown> => {
  const webkit = loadWebKitGtkFFI();
  const jsc = loadJscFFI();
  const glib = loadGlibFFI();

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let callback: JSCallback | undefined;

    const release = (): void => {
      if (callback !== undefined) {
        inFlight.delete(callback);
        callback.close();
        callback = undefined;
      }
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      release();
      reject(new Error(`executeJavaScript timed out after ${EVAL_TIMEOUT_MS}ms`));
    }, EVAL_TIMEOUT_MS);

    // NULL-initialized `GError*` out-slot. The callback closes over `errorSlot`
    // itself (not just its pointer number) so Bun's GC cannot free the buffer
    // before the async finish() writes into it; ptr() is taken at call time.
    const errorSlot = new BigUint64Array(1);

    callback = new JSCallback((source: Pointer, result: Pointer, _userData: Pointer): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const errorSlotPtr = ptr(errorSlot);
      const value = webkit.symbols.webkit_web_view_evaluate_javascript_finish(
        source,
        result,
        errorSlotPtr,
      );
      if (value === null) {
        const message = takeGErrorMessage(errorSlotPtr);
        release();
        reject(new Error(message));
        return;
      }
      const jsonPtr = jsc.symbols.jsc_value_to_json(value, 0);
      release();
      if (jsonPtr === null) {
        resolve(undefined);
        return;
      }
      const json = new CString(jsonPtr).toString();
      glib.symbols.g_free(jsonPtr);
      try {
        resolve(json === '' ? undefined : JSON.parse(json));
      } catch {
        // A non-JSON serialization resolves to undefined (JSON.stringify semantics).
        resolve(undefined);
      }
    }, ASYNC_READY_CB_DEF);
    inFlight.add(callback);

    webkit.symbols.webkit_web_view_evaluate_javascript(
      view,
      cstr(code),
      -1n,
      null,
      null,
      null,
      callback.ptr,
      null,
    );
  });
};
