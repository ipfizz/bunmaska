import { FFIType } from 'bun:ffi';
import { InvalidArgumentError } from '../../../common/errors';
import {
  type Cookie,
  type CookieFilter,
  cookiesToRemove,
  filterCookies,
} from '../../api/cookie-util';
import { makeOneShotBlock } from './cocoa-block';
import { nsString, nsStringToString } from './cocoa-foundation';
import {
  msgSendF64,
  msgSendI64,
  msgSendPtr,
  msgSendPtrPtr,
  msgSendReturnsF64,
  msgSendReturnsU8,
} from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { loadWebKit } from './cocoa-webkit';
import type { Handle } from './objc';

const TIMEOUT_MS = 15_000;

/** The default data store's `WKHTTPCookieStore`. */
const cookieStore = (): Handle => {
  // WKWebsiteDataStore exists only once WebKit is loaded; before any window it is class-not-found.
  loadWebKit();
  const rt = cocoa();
  const store = rt.msgSend(
    rt.classes.get('WKWebsiteDataStore'),
    rt.selectors.get('defaultDataStore'),
  );
  return rt.msgSend(store, rt.selectors.get('httpCookieStore'));
};

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

/**
 * Run `run` with settle callbacks under a deadline; a throw from `run` rejects. A timed-out
 * Block is never cancelled: WebKit may still invoke it, and a closed trampoline would SIGSEGV.
 */
export const bounded = <T>(
  label: string,
  run: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    const fail = (error: Error): void => {
      clearTimeout(timer);
      reject(error);
    };
    try {
      run((value) => {
        clearTimeout(timer);
        resolve(value);
      }, fail);
    } catch (cause) {
      fail(asError(cause));
    }
  });

/** Read one `NSHTTPCookie` into the shared {@link Cookie} shape. */
const readCookie = (handle: Handle): Cookie => {
  const rt = cocoa();
  const expires = rt.msgSend(handle, rt.selectors.get('expiresDate'));
  return {
    name: nsStringToString(rt.msgSend(handle, rt.selectors.get('name'))),
    value: nsStringToString(rt.msgSend(handle, rt.selectors.get('value'))),
    domain: nsStringToString(rt.msgSend(handle, rt.selectors.get('domain'))),
    path: nsStringToString(rt.msgSend(handle, rt.selectors.get('path'))),
    secure: msgSendReturnsU8(handle, rt.selectors.get('isSecure')) !== 0,
    httpOnly: msgSendReturnsU8(handle, rt.selectors.get('isHTTPOnly')) !== 0,
    ...(expires !== 0n
      ? { expirationDate: msgSendReturnsF64(expires, rt.selectors.get('timeIntervalSince1970')) }
      : {}),
  };
};

/**
 * `onCookies` runs INSIDE the `getAllCookies:` block, while the autoreleased NSArray still
 * owns the cookies: issue every per-cookie native call (e.g. `deleteCookie:`) there, not later.
 */
const getAllCookieHandles = (onCookies: (handles: Handle[]) => void): void => {
  const rt = cocoa();
  const block = makeOneShotBlock(
    (array) => {
      const arr = BigInt(array ?? 0);
      const handles: Handle[] = [];
      if (arr !== 0n) {
        const count = Number(rt.msgSend(arr, rt.selectors.get('count')));
        for (let i = 0; i < count; i += 1) {
          handles.push(msgSendI64(arr, rt.selectors.get('objectAtIndex:'), BigInt(i)));
        }
      }
      onCookies(handles);
    },
    [FFIType.u64],
  );
  msgSendPtr(cookieStore(), rt.selectors.get('getAllCookies:'), block);
};

export const getCookies = (filter: CookieFilter): Promise<Cookie[]> =>
  bounded('cookies.get', (resolve, reject) => {
    getAllCookieHandles((handles) => {
      try {
        resolve(filterCookies(handles.map(readCookie), filter));
      } catch (cause) {
        reject(asError(cause));
      }
    });
  });

/** Build an autoreleased `NSHTTPCookie` for `cookie`, or `0n` when Foundation rejects it. */
export const nsHTTPCookie = (cookie: Cookie): Handle => {
  const rt = cocoa();
  const dict = rt.msgSend(rt.classes.get('NSMutableDictionary'), rt.selectors.get('dictionary'));
  const setProperty = (key: string, value: Handle): void => {
    msgSendPtrPtr(dict, rt.selectors.get('setObject:forKey:'), value, nsString(key));
  };
  setProperty('Name', nsString(cookie.name));
  setProperty('Value', nsString(cookie.value));
  setProperty('Domain', nsString(cookie.domain));
  setProperty('Path', nsString(cookie.path));
  // Electron defaults sameSite to lax; the key and value are NSHTTPCookieSameSitePolicy/Lax.
  setProperty('SameSite', nsString('lax'));
  if (cookie.secure) {
    setProperty('Secure', nsString('TRUE'));
  }
  if (cookie.httpOnly) {
    setProperty('HttpOnly', nsString('TRUE'));
  }
  if (cookie.expirationDate !== undefined) {
    setProperty(
      'Expires',
      msgSendF64(
        rt.classes.get('NSDate'),
        rt.selectors.get('dateWithTimeIntervalSince1970:'),
        cookie.expirationDate,
      ),
    );
  }
  return msgSendPtr(
    rt.classes.get('NSHTTPCookie'),
    rt.selectors.get('cookieWithProperties:'),
    dict,
  );
};

export const setCookie = (cookie: Cookie): Promise<void> =>
  bounded('cookies.set', (resolve, reject) => {
    const rt = cocoa();
    const nsCookie = nsHTTPCookie(cookie);
    if (nsCookie === 0n) {
      reject(
        new InvalidArgumentError('cookies.set: NSHTTPCookie rejected the properties (empty name?)'),
      );
      return;
    }
    const block = makeOneShotBlock(() => resolve(undefined), []);
    msgSendPtrPtr(cookieStore(), rt.selectors.get('setCookie:completionHandler:'), nsCookie, block);
  });

export const removeCookie = (url: string, name: string): Promise<void> =>
  bounded('cookies.remove', (resolve, reject) => {
    const rt = cocoa();
    getAllCookieHandles((handles) => {
      try {
        const pairs = handles.map((handle) => ({ handle, cookie: readCookie(handle) }));
        const matches = new Set(
          cookiesToRemove(
            pairs.map((pair) => pair.cookie),
            url,
            name,
          ),
        );
        const targets = pairs.filter((pair) => matches.has(pair.cookie));
        if (targets.length === 0) {
          resolve(undefined);
          return;
        }
        let remaining = targets.length;
        for (const target of targets) {
          const done = makeOneShotBlock(() => {
            remaining -= 1;
            if (remaining === 0) {
              resolve(undefined);
            }
          }, []);
          // Issued inside the getAllCookies: block - see getAllCookieHandles.
          msgSendPtrPtr(
            cookieStore(),
            rt.selectors.get('deleteCookie:completionHandler:'),
            target.handle,
            done,
          );
        }
      } catch (cause) {
        reject(asError(cause));
      }
    });
  });
