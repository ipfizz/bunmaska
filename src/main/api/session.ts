/**
 * Session - a drop-in subset of Electron's `session` / `Session`.
 *
 * `setUserAgent(ua)` applies only to windows created AFTERWARD, at construction
 * (before their first navigation); change a live one with
 * `webContents.setUserAgent(ua)`. Kept free of a `BrowserWindow` import so it
 * can be read at window construction without a cycle.
 */

import { InvalidArgumentError, UnsupportedPlatformError } from '../../common/errors';
import { ensureNativeStarted } from '../bootstrap';
import { currentPlatform } from '../../common/platform';
import {
  type Cookie,
  type CookieFilter,
  type CookieSetDetails,
  cookieFromSetDetails,
} from './cookie-util';
import * as macosCookies from '../platform/macos/cocoa-cookies';
import * as macosWebsiteData from '../platform/macos/cocoa-website-data';
import * as linuxCookies from '../platform/linux/webkit-cookies';
import { windowsSessionBackend } from '../platform/windows/windows-session';

export type SessionBackend = {
  clearStorageData(): Promise<void>;
  /** Resolve the cookies matching `filter` (already filtered by the backend). */
  getCookies(filter: CookieFilter): Promise<Cookie[]>;
  /** Store a fully normalized cookie (the API layer derives domain/path). */
  setCookie(cookie: Cookie): Promise<void>;
  /** Delete every cookie named `name` that matches `url`'s host and path. */
  removeCookie(url: string, name: string): Promise<void>;
};

const macosBackend: SessionBackend = {
  clearStorageData: () => macosWebsiteData.clearStorageData(),
  getCookies: (filter) => macosCookies.getCookies(filter),
  setCookie: (cookie) => macosCookies.setCookie(cookie),
  removeCookie: (url, name) => macosCookies.removeCookie(url, name),
};

const linuxBackend: SessionBackend = {
  // WebKitWebsiteDataManager clearing is a follow-up (see PARITY.md).
  clearStorageData: () =>
    Promise.reject(
      new UnsupportedPlatformError('session.clearStorageData is not yet wired on Linux'),
    ),
  getCookies: (filter) => linuxCookies.getCookies(filter),
  setCookie: (cookie) => linuxCookies.setCookie(cookie),
  removeCookie: (url, name) => linuxCookies.removeCookie(url, name),
};

let backend: SessionBackend | undefined;

const getBackend = (): SessionBackend => {
  if (backend !== undefined) {
    return backend;
  }
  if (currentPlatform() === 'macos') {
    return macosBackend;
  }
  if (currentPlatform() === 'linux') {
    return linuxBackend;
  }
  if (currentPlatform() === 'windows') {
    return windowsSessionBackend;
  }
  throw new UnsupportedPlatformError(`session is not supported on ${currentPlatform()} yet`);
};

/** Override the native session backend. Test-only. */
export const setSessionBackendForTesting = (fake: SessionBackend | undefined): void => {
  backend = fake;
};

/**
 * Electron's `session.cookies` subset. Works on macOS and Linux; every method
 * rejects on Windows (the WinCairo WebKit C API gap - see windows-session.ts).
 */
export class Cookies {
  /**
   * Start the native app first: cookie completion handlers are delivered by the
   * run-loop pump, so a call before start would hang to its timeout instead.
   */
  #ensureStarted(): void {
    // With a fake backend installed there is no pump to start, and unit tests
    // must never require a display.
    if (backend === undefined) {
      ensureNativeStarted();
    }
  }

  /** Resolve the cookies matching `filter` (all cookies when omitted). */
  get(filter: CookieFilter = {}): Promise<Cookie[]> {
    this.#ensureStarted();
    return getBackend().getCookies(filter);
  }

  /**
   * Store a cookie. `details.url` is required; domain/path derive from it when
   * absent. macOS accepts but cannot persist `httpOnly` (no public NSHTTPCookie
   * property key); Linux persists it.
   */
  async set(details: CookieSetDetails): Promise<void> {
    if (typeof details.url !== 'string' || details.url === '') {
      throw new InvalidArgumentError('cookies.set requires a url');
    }
    this.#ensureStarted();
    return getBackend().setCookie(cookieFromSetDetails(details));
  }

  /** Delete every cookie named `name` matching `url`'s host and path. */
  async remove(url: string, name: string): Promise<void> {
    if (typeof url !== 'string' || url === '') {
      throw new InvalidArgumentError('cookies.remove requires a url');
    }
    if (typeof name !== 'string' || name === '') {
      throw new InvalidArgumentError('cookies.remove requires a cookie name');
    }
    this.#ensureStarted();
    return getBackend().removeCookie(url, name);
  }
}

export class Session {
  #userAgent = '';

  /** Cookie store access (Electron's `session.cookies`). */
  readonly cookies = new Cookies();

  /** The session's User-Agent override, or `''` when none is set. */
  getUserAgent(): string {
    return this.#userAgent;
  }

  /** Applies to web contents created after this call, not to existing ones. */
  setUserAgent(userAgent: string): void {
    this.#userAgent = userAgent;
  }

  /** Clears cache, cookies, local/session storage, IndexedDB, … Rejects on Linux. */
  clearStorageData(): Promise<void> {
    return getBackend().clearStorageData();
  }

  /** Clear the override (revert to the platform default). Test-only convenience. */
  resetForTesting(): void {
    this.#userAgent = '';
  }
}

/** The `session` module - Electron's `session.defaultSession`. */
export const session: { readonly defaultSession: Session } = {
  defaultSession: new Session(),
};
