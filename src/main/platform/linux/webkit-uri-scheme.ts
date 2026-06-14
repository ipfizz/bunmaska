import { CString, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import { type BuiltProtocolResponse, protocol } from '../../api/protocol';
import { cstr } from '../cstr';
import { loadGioFFI } from './gio-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';
import { loadWebKitGtkFFI } from './webkitgtk-ffi';

/**
 * Bridges WebKitGTK custom URI-scheme requests to the `protocol` module on
 * Linux — the mirror of `cocoa-url-scheme-handler.ts`.
 *
 * `webkit_web_context_register_uri_scheme(context, scheme, callback, …)` routes
 * every request to a custom scheme (e.g. `app`) to a
 * `WebKitURISchemeRequestCallback`. The callback reads the request URI, asks
 * {@link protocol.dispatch} for the bytes + MIME type, wraps the bytes in a
 * `GBytes` → `GMemoryInputStream`, and completes the request with
 * `webkit_uri_scheme_request_finish` (or `…finish_error` when there is no
 * handler / the handler declined).
 *
 * JSCallback lifecycle: each scheme's callback is a {@link JSCallback} retained
 * in a module-level Set for the process lifetime (the libnotify / gtk-clipboard
 * pattern). It is NEVER closed inside its own invocation — closing the thunk
 * mid-callback frees the native trampoline GObject still points at (SIGSEGV).
 * Schemes are registered once per process on the default context; a second
 * registration of the same scheme is a guarded no-op (WebKit aborts on a
 * duplicate registration).
 */

const log = createLogger('linux-uri-scheme');

/** The Bunmaska error domain for a failed custom-scheme request. */
const ERROR_DOMAIN = 'BunmaskaProtocol';
/** Error code for an unhandled/declined request. */
const ERROR_CODE_NO_HANDLER = 1;

/** Retains every URI-scheme {@link JSCallback} for the process lifetime. */
const retainedCallbacks = new Set<JSCallback>();
/** Schemes already registered on the (single, default) context — dedup guard. */
const registeredSchemes = new Set<string>();

/**
 * The dispatcher the callback uses to serve a URI. Defaults to the live
 * {@link protocol.dispatch}; overridable for unit tests.
 */
let dispatcher: (url: string) => BuiltProtocolResponse | undefined = protocol.dispatch;

/** Override the URI dispatcher. Test-only. */
export const setUriSchemeDispatcherForTesting = (
  fake: ((url: string) => BuiltProtocolResponse | undefined) | undefined,
): void => {
  dispatcher = fake ?? protocol.dispatch;
};

/** Reset the registration guard + drop retained callbacks. Test-only. */
export const resetUriSchemeRegistryForTesting = (): void => {
  for (const callback of retainedCallbacks) {
    callback.close();
  }
  retainedCallbacks.clear();
  registeredSchemes.clear();
};

/** Read the (transfer-none) request URI as a JS string. */
const requestUri = (request: Pointer): string => {
  const webkit = loadWebKitGtkFFI();
  const uriPtr = webkit.symbols.webkit_uri_scheme_request_get_uri(request);
  return uriPtr === null ? '' : new CString(uriPtr).toString();
};

/**
 * Complete `request` with an error (no handler / declined). Best-effort: builds
 * a GError, finishes the request with it, then frees the GError.
 */
const finishError = (request: Pointer): void => {
  const webkit = loadWebKitGtkFFI();
  const glib = loadGlibFFI();
  const domain = glib.symbols.g_quark_from_string(cstr(ERROR_DOMAIN));
  const error = glib.symbols.g_error_new_literal(
    domain,
    ERROR_CODE_NO_HANDLER,
    cstr('no protocol handler'),
  );
  webkit.symbols.webkit_uri_scheme_request_finish_error(request, error);
  if (error !== null) {
    glib.symbols.g_error_free(error);
  }
};

/**
 * Serve `built` to `request`: copy the bytes into a `GBytes`, wrap it in a
 * `GMemoryInputStream`, then complete via `webkit_uri_scheme_request_finish`.
 * The stream is owned by `finish` (it takes its own ref); the local `GBytes`
 * (and the stream ref we hold) are dropped after the call.
 */
const finishWithBytes = (request: Pointer, built: BuiltProtocolResponse): void => {
  const webkit = loadWebKitGtkFFI();
  const glib = loadGlibFFI();
  const gio = loadGioFFI();

  // g_bytes_new copies, so `bytes` only needs to outlive this call. A zero-length
  // body still produces a valid (empty) GBytes/stream.
  const bytes = built.bytes;
  const dataPtr = bytes.length === 0 ? null : ptr(bytes);
  const gbytes = glib.symbols.g_bytes_new(dataPtr, bytes.length);
  if (gbytes === null) {
    log.warn('g_bytes_new returned null; failing the request');
    finishError(request);
    return;
  }

  const stream = gio.symbols.g_memory_input_stream_new_from_bytes(gbytes);
  // The stream took its own ref on the GBytes; drop our local one.
  glib.symbols.g_bytes_unref(gbytes);
  if (stream === null) {
    log.warn('g_memory_input_stream_new_from_bytes returned null; failing the request');
    finishError(request);
    return;
  }

  webkit.symbols.webkit_uri_scheme_request_finish(
    request,
    stream,
    BigInt(bytes.length),
    cstr(built.mimeType),
  );
  // finish() took its own ref on the stream; drop the one g_memory_input_stream
  // handed us (transfer-full) so the stream is freed once WebKit is done.
  loadGObjectFFI().symbols.g_object_unref(stream);
};

/**
 * @internal The body of the URI-scheme callback, factored out so the serve/fail
 * decision is exercised directly. Reads the URI, dispatches it, and either
 * serves the bytes or finishes with an error. Never throws out into the
 * callback (any error completes with an error instead).
 */
export const handleUriSchemeRequest = (request: Pointer): void => {
  try {
    const url = requestUri(request);
    const built = dispatcher(url);
    if (built === undefined) {
      finishError(request);
      return;
    }
    finishWithBytes(request, built);
  } catch (caught) {
    log.warn('uri-scheme request handler threw; finishing with an error', caught);
    finishError(request);
  }
};

/** ABI shape for `WebKitURISchemeRequestCallback`: `(request, user_data) -> void`. */
export const URI_SCHEME_CB_DEF = { args: ['ptr', 'ptr'], returns: 'void' } as const;

/** Build the retained URI-scheme {@link JSCallback}. */
const makeUriSchemeCallback = (): JSCallback =>
  new JSCallback((request: Pointer, _userData: Pointer): void => {
    handleUriSchemeRequest(request);
  }, URI_SCHEME_CB_DEF);

/** Get the WebKit context for `view` (or the process-wide default if `view` is null). */
const contextFor = (view: Pointer | null): Pointer | null => {
  const webkit = loadWebKitGtkFFI();
  if (view === null) {
    return webkit.symbols.webkit_web_context_get_default();
  }
  return webkit.symbols.webkit_web_view_get_context(view);
};

/**
 * Register a custom URI scheme on `view`'s WebKit context (or the default
 * context when `view` is null). Idempotent per scheme name: registering an
 * already-registered scheme is a no-op (WebKit aborts on a duplicate
 * registration on the same context).
 *
 * The callback {@link JSCallback} is retained for the process lifetime — never
 * closed inside its own invocation.
 */
export const registerUriScheme = (scheme: string, view: Pointer | null): void => {
  if (registeredSchemes.has(scheme)) {
    return;
  }
  const context = contextFor(view);
  if (context === null) {
    log.warn(`could not resolve a WebKit context to register scheme '${scheme}'`);
    return;
  }
  const webkit = loadWebKitGtkFFI();
  const callback = makeUriSchemeCallback();
  if (callback.ptr === null) {
    callback.close();
    throw new Error(`failed to allocate a URI-scheme callback thunk for '${scheme}'`);
  }
  retainedCallbacks.add(callback);
  webkit.symbols.webkit_web_context_register_uri_scheme(
    context,
    cstr(scheme),
    callback.ptr,
    null,
    null,
  );
  registeredSchemes.add(scheme);
};

/**
 * Register every scheme currently registered with the `protocol` module on
 * `view`'s context. Called at web-view creation so custom schemes are wired
 * before any load. Each scheme is registered once per process (the dedup guard).
 */
export const registerAllSchemes = (view: Pointer | null): void => {
  for (const scheme of protocol.getRegisteredSchemes()) {
    registerUriScheme(scheme, view);
  }
};
