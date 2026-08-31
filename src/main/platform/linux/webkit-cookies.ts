import { CString, type Pointer, read } from 'bun:ffi';
import { InvalidArgumentError } from '../../../common/errors';
import {
  type Cookie,
  type CookieFilter,
  cookiesToRemove,
  filterCookies,
} from '../../api/cookie-util';
import { cstr } from '../cstr';
import { runAsyncReady, withDeadline } from './gasync';
import { loadGlibFFI } from './glib-ffi';
import { loadSoupFFI } from './soup-ffi';
import { loadWebKitGtkFFI } from './webkitgtk-ffi';

/**
 * `session.cookies` on Linux (WebKitGTK 6.0) via the default network session's
 * `WebKitCookieManager`. Async settles follow the gasync.ts callback rules.
 */

const COOKIE_TIMEOUT_MS = 15_000;

const asPointer = (value: number): Pointer => value as Pointer;

const cookieManager = (): Pointer => {
  const wk = loadWebKitGtkFFI().symbols;
  const session = wk.webkit_network_session_get_default();
  if (session === null) {
    throw new Error('webkit_network_session_get_default returned null');
  }
  const manager = wk.webkit_network_session_get_cookie_manager(session);
  if (manager === null) {
    throw new Error('webkit_network_session_get_cookie_manager returned null');
  }
  return manager;
};

const borrowedString = (pointer: Pointer | null): string =>
  pointer === null ? '' : new CString(pointer).toString();

const readSoupCookie = (cookie: Pointer): Cookie => {
  const soup = loadSoupFFI().symbols;
  const glib = loadGlibFFI().symbols;
  const expires = soup.soup_cookie_get_expires(cookie);
  return {
    name: borrowedString(soup.soup_cookie_get_name(cookie)),
    value: borrowedString(soup.soup_cookie_get_value(cookie)),
    domain: borrowedString(soup.soup_cookie_get_domain(cookie)),
    path: borrowedString(soup.soup_cookie_get_path(cookie)),
    secure: soup.soup_cookie_get_secure(cookie) !== 0,
    httpOnly: soup.soup_cookie_get_http_only(cookie) !== 0,
    ...(expires !== null ? { expirationDate: Number(glib.g_date_time_to_unix(expires)) } : {}),
  };
};

/**
 * Drain a transfer-full `GList` of `SoupCookie*` into JS cookies: each node's
 * data is `soup_cookie_free`d and the cells `g_list_free`d (the finish
 * contract - anything less leaks per call).
 */
const drainCookieList = (list: Pointer | null): Cookie[] => {
  const soup = loadSoupFFI().symbols;
  const glib = loadGlibFFI().symbols;
  const cookies: Cookie[] = [];
  let node = list === null ? 0 : Number(list);
  while (node !== 0) {
    const data = read.ptr(asPointer(node), 0);
    if (data !== 0) {
      cookies.push(readSoupCookie(asPointer(data)));
      soup.soup_cookie_free(asPointer(data));
    }
    node = read.ptr(asPointer(node), 8);
  }
  if (list !== null) {
    glib.g_list_free(list);
  }
  return cookies;
};

const allCookies = (): Promise<Cookie[]> => {
  const wk = loadWebKitGtkFFI().symbols;
  const manager = cookieManager();
  return runAsyncReady(
    (cb) => wk.webkit_cookie_manager_get_all_cookies(manager, null, cb, null),
    (result) =>
      drainCookieList(wk.webkit_cookie_manager_get_all_cookies_finish(manager, result, null)),
  );
};

export const getCookies = (filter: CookieFilter): Promise<Cookie[]> =>
  withDeadline(
    allCookies().then((cookies) => filterCookies(cookies, filter)),
    COOKIE_TIMEOUT_MS,
    'cookies.get',
  );

/** Build a `SoupCookie*` from the normalized shape; expiration maps to max-age seconds. */
const buildSoupCookie = (cookie: Cookie): Pointer => {
  const soup = loadSoupFFI().symbols;
  const maxAge =
    cookie.expirationDate === undefined
      ? -1
      : Math.max(0, Math.round(cookie.expirationDate - Date.now() / 1000));
  const soupCookie = soup.soup_cookie_new(
    cstr(cookie.name),
    cstr(cookie.value),
    cstr(cookie.domain),
    cstr(cookie.path),
    maxAge,
  );
  if (soupCookie === null) {
    throw new InvalidArgumentError('cookies.set: soup_cookie_new rejected the cookie fields');
  }
  soup.soup_cookie_set_secure(soupCookie, cookie.secure ? 1 : 0);
  soup.soup_cookie_set_http_only(soupCookie, cookie.httpOnly ? 1 : 0);
  return soupCookie;
};

export const setCookie = (cookie: Cookie): Promise<void> => {
  const wk = loadWebKitGtkFFI().symbols;
  const soup = loadSoupFFI().symbols;
  const manager = cookieManager();
  const soupCookie = buildSoupCookie(cookie);
  return withDeadline(
    runAsyncReady(
      (cb) => wk.webkit_cookie_manager_add_cookie(manager, soupCookie, null, cb, null),
      (result) => {
        const ok = wk.webkit_cookie_manager_add_cookie_finish(manager, result, null);
        // Freed only after the finish - the async op may still read it before then.
        soup.soup_cookie_free(soupCookie);
        if (ok === 0) {
          throw new Error('cookies.set failed (webkit_cookie_manager_add_cookie)');
        }
      },
    ),
    COOKIE_TIMEOUT_MS,
    'cookies.set',
  );
};

/**
 * Delete one stored cookie. The match goes through soup_cookie_equal, which
 * compares the VALUE too - blanking it made every delete a silent no-op (a CI
 * catch), so the cookie is rebuilt verbatim from the read-back fields.
 */
const deleteOne = (target: Cookie): Promise<void> => {
  const wk = loadWebKitGtkFFI().symbols;
  const soup = loadSoupFFI().symbols;
  const manager = cookieManager();
  const soupCookie = buildSoupCookie(target);
  return runAsyncReady(
    (cb) => wk.webkit_cookie_manager_delete_cookie(manager, soupCookie, null, cb, null),
    (result) => {
      wk.webkit_cookie_manager_delete_cookie_finish(manager, result, null);
      soup.soup_cookie_free(soupCookie);
    },
  );
};

export const removeCookie = (url: string, name: string): Promise<void> =>
  withDeadline(
    allCookies().then(async (cookies) => {
      await Promise.all(cookiesToRemove(cookies, url, name).map(deleteOne));
    }),
    COOKIE_TIMEOUT_MS,
    'cookies.remove',
  );
