import { InvalidArgumentError } from '../../common/errors';

/** String `data` is UTF-8 encoded, bytes go out verbatim; `mimeType` defaults to `text/html`. */
export type ProtocolResponse = {
  readonly data: string | Uint8Array;
  readonly mimeType?: string;
};

export type ProtocolRequest = {
  readonly url: string;
};

/** Returns `undefined` to decline: the backend fails the request with a network error. */
export type ProtocolHandler = (request: ProtocolRequest) => ProtocolResponse | undefined;

export type BuiltProtocolResponse = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

export const DEFAULT_MIME_TYPE = 'text/html';

/** Canonical registry key: lowercased, trimmed, trailing `:` or `://` stripped. */
export const normalizeScheme = (scheme: string): string =>
  scheme
    .trim()
    .toLowerCase()
    .replace(/:(\/\/)?$/, '');

/** Lowercased scheme of `url`, or `undefined`; avoids `URL`, which rejects some custom schemes. */
export const schemeOfUrl = (url: string): string | undefined => {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  return match?.[1]?.toLowerCase();
};

const toBytes = (data: string | Uint8Array): Uint8Array =>
  typeof data === 'string' ? new TextEncoder().encode(data) : data;

/** `undefined` when the handler declines. */
export const buildProtocolResponse = (
  handler: ProtocolHandler,
  request: ProtocolRequest,
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

/** WKWebView raises an uncatchable NSInvalidArgumentException for these (`+handlesURLScheme:`). */
const ENGINE_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'file',
  'about',
  'data',
  'blob',
  'ws',
  'wss',
  'javascript',
  'ftp',
  'applewebdata',
  'webkit-fake-url',
]);

/**
 * Re-registering replaces the handler. Register BEFORE creating the window that serves the
 * scheme: the backends read {@link getRegisteredSchemes} only at web-view creation.
 */
const handle = (scheme: string, handler: ProtocolHandler): void => {
  const normalized = normalizeScheme(scheme);
  if (!/^[a-z][a-z0-9+.-]*$/.test(normalized)) {
    throw new InvalidArgumentError(`protocol.handle: '${scheme}' is not a valid URL scheme`);
  }
  if (ENGINE_SCHEMES.has(normalized)) {
    throw new InvalidArgumentError(
      `protocol.handle: WebKit serves '${normalized}' itself and cannot intercept it; use a custom scheme`,
    );
  }
  registry.set(normalized, handler);
};

const unhandle = (scheme: string): void => {
  registry.delete(normalizeScheme(scheme));
};

const isProtocolHandled = (scheme: string): boolean => registry.has(normalizeScheme(scheme));

const getRegisteredSchemes = (): string[] => [...registry.keys()];

/** `undefined` for an unregistered scheme, an unparseable URL, or a handler that declined. */
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

/** Electron's `protocol`, for custom schemes only. */
export const protocol = {
  handle,
  unhandle,
  isProtocolHandled,
  getRegisteredSchemes,
  dispatch,
};
