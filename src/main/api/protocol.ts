/**
 * Custom URL-scheme registration — the drop-in equivalent of Electron's
 * `protocol` module (v1).
 *
 * A handler registered for a scheme (e.g. `app`) is called for every request to
 * that scheme and returns the bytes + MIME type to serve, so bundled assets can
 * be delivered from `app://host/index.html` without a real HTTP server.
 *
 * The public surface here is PURE TS: a module-level registry plus the
 * response-building logic (string→utf8 bytes, default MIME type, unknown-scheme
 * handling), all unit-testable on any host. The native wiring lives in the
 * per-platform backends, which read {@link protocol.getRegisteredSchemes} at
 * web-view creation (custom schemes MUST be registered on the web-view config
 * BEFORE the view exists) and call {@link protocol.dispatch} to serve a request.
 */

/**
 * What a protocol handler returns for a request. `data` is the response body
 * (a `string` is UTF-8 encoded; a `Uint8Array` is served verbatim). `mimeType`
 * defaults to `text/html`.
 */
export type ProtocolResponse = {
  readonly data: string | Uint8Array;
  readonly mimeType?: string;
};

/** The request passed to a protocol handler. `url` is the full request URL. */
export type ProtocolRequest = {
  readonly url: string;
};

/**
 * A protocol handler. Returns a {@link ProtocolResponse} to serve, or
 * `undefined` for a 404-ish failed/empty response.
 */
export type ProtocolHandler = (request: ProtocolRequest) => ProtocolResponse | undefined;

/** A built response: the raw bytes to serve plus the resolved MIME type. */
export type BuiltProtocolResponse = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

/** The default MIME type when a handler does not specify one. */
export const DEFAULT_MIME_TYPE = 'text/html';

/**
 * Normalize a scheme to its canonical registry key: lowercased, trimmed, and
 * stripped of a trailing `:` or `://` (so `APP://`, `app:`, and `app` all map
 * to `app`).
 */
export const normalizeScheme = (scheme: string): string =>
  scheme
    .trim()
    .toLowerCase()
    .replace(/:(\/\/)?$/, '');

/**
 * Extract the (lowercased) scheme from a full URL, or `undefined` if the URL has
 * no `scheme:` prefix. Does not depend on `URL` so a custom scheme parses even
 * where the WHATWG parser would reject it.
 */
export const schemeOfUrl = (url: string): string | undefined => {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  return match?.[1]?.toLowerCase();
};

/** Encode a handler's `data` into the raw bytes to serve. */
const toBytes = (data: string | Uint8Array): Uint8Array =>
  typeof data === 'string' ? new TextEncoder().encode(data) : data;

/**
 * Run `handler` for `request` and build the response to serve: UTF-8 bytes for a
 * string body, the buffer verbatim for a `Uint8Array`, and the resolved MIME
 * type (defaulting to `text/html`). Returns `undefined` when the handler
 * declines (so the backend can fail the task / serve a 404-ish empty response).
 */
export const buildProtocolResponse = (
  handler: ProtocolHandler,
  request: ProtocolRequest = { url: '' },
): BuiltProtocolResponse | undefined => {
  const response = handler(request);
  if (response === undefined) {
    return undefined;
  }
  return {
    bytes: toBytes(response.data),
    mimeType: response.mimeType ?? DEFAULT_MIME_TYPE,
  };
};

const registry = new Map<string, ProtocolHandler>();

/**
 * Register `handler` to serve requests for `scheme` (e.g. `app`). The scheme is
 * normalized, so `handle('APP://', ...)` and `handle('app', ...)` are the same
 * registration. Re-registering a scheme replaces the previous handler.
 *
 * Schemes must be registered BEFORE the window/web view that serves them is
 * created — the backends read {@link getRegisteredSchemes} at view creation.
 */
const handle = (scheme: string, handler: ProtocolHandler): void => {
  registry.set(normalizeScheme(scheme), handler);
};

/** Remove the handler for `scheme`. No-op if it was not registered. */
const unhandle = (scheme: string): void => {
  registry.delete(normalizeScheme(scheme));
};

/** Whether `scheme` currently has a registered handler. */
const isProtocolHandled = (scheme: string): boolean => registry.has(normalizeScheme(scheme));

/**
 * Every currently registered scheme (normalized). The backends iterate this at
 * web-view creation to wire each scheme onto the native web-view config.
 */
const getRegisteredSchemes = (): string[] => [...registry.keys()];

/** The handler registered for `scheme`, or `undefined`. */
const handlerFor = (scheme: string): ProtocolHandler | undefined =>
  registry.get(normalizeScheme(scheme));

/**
 * Serve `url`: parse its scheme, look up the handler, and build the response.
 * Returns `undefined` for an unregistered scheme, an unparseable URL, or a
 * handler that declined — the caller fails the request / serves a 404-ish empty
 * response. This is the single dispatch entry point both native backends call.
 */
const dispatch = (url: string): BuiltProtocolResponse | undefined => {
  const scheme = schemeOfUrl(url);
  if (scheme === undefined) {
    return undefined;
  }
  const handler = registry.get(scheme);
  if (handler === undefined) {
    return undefined;
  }
  return buildProtocolResponse(handler, { url });
};

/** Clear every registered scheme. Test-only. */
const clearForTesting = (): void => {
  registry.clear();
};

/** The `protocol` module — Electron-compatible custom URL-scheme registration. */
export const protocol = {
  handle,
  unhandle,
  isProtocolHandled,
  getRegisteredSchemes,
  handlerFor,
  dispatch,
  clearForTesting,
};
