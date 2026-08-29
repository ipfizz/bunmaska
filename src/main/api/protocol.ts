/**
 * Custom URL-scheme registration — the drop-in equivalent of Electron's
 * `protocol` module (v1). Custom schemes MUST be registered on the web-view
 * config BEFORE the view exists; the backends read
 * {@link protocol.getRegisteredSchemes} at web-view creation.
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

export type ProtocolRequest = {
  readonly url: string;
};

/** Returns `undefined` for a 404-ish failed/empty response. */
export type ProtocolHandler = (request: ProtocolRequest) => ProtocolResponse | undefined;

export type BuiltProtocolResponse = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

/** The default MIME type when a handler does not specify one. */
export const DEFAULT_MIME_TYPE = 'text/html';

/** Canonical registry key: lowercased, trimmed, trailing `:` or `://` stripped. */
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

const toBytes = (data: string | Uint8Array): Uint8Array =>
  typeof data === 'string' ? new TextEncoder().encode(data) : data;

/** Returns `undefined` when the handler declines (backend serves a 404-ish empty response). */
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
 * Register `handler` to serve requests for `scheme`; re-registering replaces it.
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

/** Every currently registered scheme, normalized. */
const getRegisteredSchemes = (): string[] => [...registry.keys()];

/** The handler registered for `scheme`, or `undefined`. */
const handlerFor = (scheme: string): ProtocolHandler | undefined =>
  registry.get(normalizeScheme(scheme));

/**
 * Serve `url`. Returns `undefined` for an unregistered scheme, an unparseable
 * URL, or a handler that declined.
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
