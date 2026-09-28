// No BrowserWindow import: windows read the session at construction (a cycle otherwise).
import { InvalidArgumentError, UnsupportedPlatformError } from '../../common/errors';
import { selectBackend } from '../platform/index';
import { ensureNativeStarted } from '../bootstrap';
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
import type { SessionBackend } from '../platform/services';

const macosBackend: SessionBackend = {
  clearStorageData: () => macosWebsiteData.clearStorageData(),
  getCookies: (filter) => macosCookies.getCookies(filter),
  setCookie: (cookie) => macosCookies.setCookie(cookie),
  removeCookie: (url, name) => macosCookies.removeCookie(url, name),
};

const linuxBackend: SessionBackend = {
  clearStorageData: () =>
    Promise.reject(
      new UnsupportedPlatformError('session.clearStorageData is not yet wired on Linux'),
    ), // ponytail: wire WebKitWebsiteDataManager clearing
  getCookies: (filter) => linuxCookies.getCookies(filter),
  setCookie: (cookie) => linuxCookies.setCookie(cookie),
  removeCookie: (url, name) => linuxCookies.removeCookie(url, name),
};

const { get: getBackend, setForTesting } = selectBackend<SessionBackend>('session', {
  macos: () => macosBackend,
  linux: () => linuxBackend,
  windows: () => windowsSessionBackend,
});

let fakeInstalled = false;
/** @internal */
export const setSessionBackendForTesting = (fake: SessionBackend | undefined): void => {
  fakeInstalled = fake !== undefined;
  setForTesting(fake);
};

/**
 * Completion handlers arrive on the run-loop pump, so a call before start would hang to its
 * timeout. A fake backend has no pump, and unit tests must never need a display.
 */
const ensureStarted = (): void => {
  if (!fakeInstalled) {
    ensureNativeStarted();
  }
};

/** Electron's `session.cookies` subset; every method rejects on Windows (no WinCairo API). */
export class Cookies {
  /** All cookies when `filter` is omitted. */
  get(filter: CookieFilter = {}): Promise<Cookie[]> {
    ensureStarted();
    return getBackend().getCookies(filter);
  }

  /** Domain and path derive from `details.url`; an explicit `domain` is dot-prefixed. */
  async set(details: CookieSetDetails): Promise<void> {
    if (typeof details.url !== 'string' || details.url === '') {
      throw new InvalidArgumentError('cookies.set requires a url');
    }
    ensureStarted();
    return getBackend().setCookie(cookieFromSetDetails(details));
  }

  /** Deletes every cookie named `name` that would be sent to `url`, `secure` aside. */
  async remove(url: string, name: string): Promise<void> {
    if (typeof url !== 'string' || url === '') {
      throw new InvalidArgumentError('cookies.remove requires a url');
    }
    if (typeof name !== 'string' || name === '') {
      throw new InvalidArgumentError('cookies.remove requires a cookie name');
    }
    ensureStarted();
    return getBackend().removeCookie(url, name);
  }
}

export class Session {
  #userAgent = '';

  readonly cookies = new Cookies();

  /** `''` when no override is set. */
  getUserAgent(): string {
    return this.#userAgent;
  }

  /** Applies to windows created afterwards; use `webContents.setUserAgent` for a live one. */
  setUserAgent(userAgent: string): void {
    this.#userAgent = userAgent;
  }

  /**
   * Clears all website data on macOS, only cookies and fetch caches on Windows, and rejects on
   * Linux. A `storages` or `origin` filter rejects rather than widening to everything.
   */
  clearStorageData(options?: {
    readonly origin?: string;
    readonly storages?: readonly string[];
  }): Promise<void> {
    if (options?.origin !== undefined || options?.storages !== undefined) {
      return Promise.reject(
        new UnsupportedPlatformError('session.clearStorageData: origin/storages filters'),
      ); // ponytail: per-type clearing needs a data-type mask on every backend
    }
    ensureStarted();
    return getBackend().clearStorageData();
  }

  /** @internal */
  resetForTesting(): void {
    this.#userAgent = '';
  }
}

/** Electron's `session`, with `defaultSession` only. */
export const session: { readonly defaultSession: Session } = {
  defaultSession: new Session(),
};
