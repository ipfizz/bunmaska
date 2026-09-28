import { CString, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import { cstr } from '../cstr';
import type { BuiltProtocolResponse, NativeProtocol } from '../native';
import { loadGioFFI } from './gio-ffi';
import { loadGlibFFI } from './glib-ffi';
import { loadGObjectFFI } from './gobject-ffi';
import { loadWebKitGtkFFI } from './webkitgtk-ffi';

const log = createLogger('linux-uri-scheme');

const ERROR_DOMAIN = 'BunmaskaProtocol';
const ERROR_CODE_NO_HANDLER = 1;

/** Scheme thunks live for the process: WebKit keeps calling them and has no unregister. */
const retainedCallbacks = new Set<JSCallback>();
/** WebKit aborts on a duplicate registration, so each scheme registers once per process. */
const registeredSchemes = new Set<string>();

/** The request URI is transfer-none: read it, never free it. */
const requestUri = (request: Pointer): string => {
  const webkit = loadWebKitGtkFFI();
  const uriPtr = webkit.symbols.webkit_uri_scheme_request_get_uri(request);
  return uriPtr === null ? '' : new CString(uriPtr).toString();
};

/** Fail `request`: no handler matched, or the handler threw. */
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

/** Ownership: `finish` refs the stream and the stream refs the GBytes, so both of our refs drop here. */
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
  // Drop our transfer-full stream ref; WebKit frees the stream when done.
  loadGObjectFFI().symbols.g_object_unref(stream);
};

/** @internal Completes the request with an error rather than throwing into the native callback. */
export const handleUriSchemeRequest = (
  request: Pointer,
  dispatch: NativeProtocol['dispatch'],
): void => {
  try {
    const url = requestUri(request);
    const built = dispatch(url);
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

/** `WebKitURISchemeRequestCallback`: `(request, user_data) -> void`. */
export const URI_SCHEME_CB_DEF = { args: ['ptr', 'ptr'], returns: 'void' } as const;

const makeUriSchemeCallback = (dispatch: NativeProtocol['dispatch']): JSCallback =>
  new JSCallback((request: Pointer, _userData: Pointer): void => {
    handleUriSchemeRequest(request, dispatch);
  }, URI_SCHEME_CB_DEF);

const contextFor = (view: Pointer | null): Pointer | null => {
  const webkit = loadWebKitGtkFFI();
  if (view === null) {
    return webkit.symbols.webkit_web_context_get_default();
  }
  return webkit.symbols.webkit_web_view_get_context(view);
};

/** Register `scheme` on `view`'s context (the default one when null); idempotent per scheme. */
export const registerUriScheme = (
  scheme: string,
  view: Pointer | null,
  dispatch: NativeProtocol['dispatch'],
): void => {
  if (registeredSchemes.has(scheme)) {
    return;
  }
  const context = contextFor(view);
  if (context === null) {
    log.warn(`could not resolve a WebKit context to register scheme '${scheme}'`);
    return;
  }
  const webkit = loadWebKitGtkFFI();
  const callback = makeUriSchemeCallback(dispatch);
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

/** Wire every `protocol.handle` scheme; call before the view's first load. */
export const registerAllSchemes = (view: Pointer | null, protocol?: NativeProtocol): void => {
  if (protocol === undefined) {
    return;
  }
  for (const scheme of protocol.schemes) {
    registerUriScheme(scheme, view, protocol.dispatch);
  }
};
