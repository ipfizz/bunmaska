import { InvalidArgumentError } from '../../common/errors';

/** Pure cookie matching/normalization shared by the session API and every backend. */

/** Electron's `Cookie` subset: `expirationDate` is unix seconds; absent = session cookie. */
export type Cookie = {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly expirationDate?: number;
};

/** Electron's `cookies.get` filter subset. All fields optional; empty = all cookies. */
export type CookieFilter = {
  readonly url?: string;
  readonly name?: string;
  readonly domain?: string;
  readonly path?: string;
};

/** Electron's `cookies.set` details subset. `url` is required (validated by the API layer). */
export type CookieSetDetails = {
  readonly url: string;
  readonly name?: string;
  readonly value?: string;
  readonly domain?: string;
  readonly path?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly expirationDate?: number;
};

const stripDot = (domain: string): string => (domain.startsWith('.') ? domain.slice(1) : domain);

/** RFC 6265 domain-match: `host` equals `cookieDomain` or is a subdomain of it. */
export const domainMatches = (cookieDomain: string, host: string): boolean => {
  const domain = stripDot(cookieDomain);
  return host === domain || host.endsWith(`.${domain}`);
};

/** RFC 6265 path-match: equal, or prefix on a `/` label boundary. */
const pathMatches = (cookiePath: string, urlPath: string): boolean =>
  urlPath === cookiePath ||
  (urlPath.startsWith(cookiePath) &&
    (cookiePath.endsWith('/') || urlPath[cookiePath.length] === '/'));

const parseUrl = (url: string, context: string): URL => {
  try {
    return new URL(url);
  } catch (cause) {
    throw new InvalidArgumentError(`${context}: invalid url "${url}"`, { cause });
  }
};

const sentToUrl = (cookie: Cookie, url: URL): boolean =>
  domainMatches(cookie.domain, url.hostname) &&
  pathMatches(cookie.path, url.pathname) &&
  (!cookie.secure || url.protocol === 'https:' || url.protocol === 'wss:');

/** Apply an Electron-style filter. Throws {@link InvalidArgumentError} on a bad `filter.url`. */
export const filterCookies = (cookies: ReadonlyArray<Cookie>, filter: CookieFilter): Cookie[] => {
  const url = filter.url === undefined ? undefined : parseUrl(filter.url, 'cookies.get');
  return cookies.filter(
    (cookie) =>
      (filter.name === undefined || cookie.name === filter.name) &&
      (filter.domain === undefined || domainMatches(filter.domain, stripDot(cookie.domain))) &&
      (filter.path === undefined || cookie.path === filter.path) &&
      (url === undefined || sentToUrl(cookie, url)),
  );
};

/**
 * The cookies `cookies.remove(url, name)` deletes: name equal, url host within the
 * cookie domain, url path within the cookie path. `secure` is deliberately ignored
 * so an http url can remove a secure cookie (removal is not a send).
 */
export const cookiesToRemove = (
  cookies: ReadonlyArray<Cookie>,
  url: string,
  name: string,
): Cookie[] => {
  const parsed = parseUrl(url, 'cookies.remove');
  return cookies.filter(
    (cookie) =>
      cookie.name === name &&
      domainMatches(cookie.domain, parsed.hostname) &&
      pathMatches(cookie.path, parsed.pathname),
  );
};

/** Normalize `cookies.set` details into a full {@link Cookie} (domain/path derived from url). */
export const cookieFromSetDetails = (details: CookieSetDetails): Cookie => {
  const url = parseUrl(details.url, 'cookies.set');
  return {
    name: details.name ?? '',
    value: details.value ?? '',
    domain: details.domain ?? url.hostname,
    path: details.path ?? '/',
    secure: details.secure ?? false,
    httpOnly: details.httpOnly ?? false,
    ...(details.expirationDate !== undefined ? { expirationDate: details.expirationDate } : {}),
  };
};
