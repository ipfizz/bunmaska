/**
 * Session — a drop-in subset of Electron's `session` / `Session`.
 *
 * Covers the default session's User-Agent override and website-data clearing.
 * `setUserAgent(ua)` stores a process-wide default that every
 * {@link BrowserWindow} created AFTERWARD applies to its web contents at
 * construction (before the first navigation). Existing views keep their current
 * UA — change a live one with `webContents.setUserAgent(ua)`. `getUserAgent()`
 * returns the override, or `''` when none is set (the platform WebKit default is
 * then used). `clearStorageData()` clears the default data store (macOS; Linux
 * is a follow-up).
 *
 * Kept free of a `BrowserWindow` import (so it can be read at window
 * construction without a cycle). Cookies / cache / proxy / partitions are a
 * follow-up.
 */

import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import * as macosWebsiteData from '../platform/macos/cocoa-website-data';

/** The native data-store operations the session delegates to. */
export type SessionBackend = {
  clearStorageData(): Promise<void>;
};

const macosBackend: SessionBackend = {
  clearStorageData: () => macosWebsiteData.clearStorageData(),
};

const linuxBackend: SessionBackend = {
  // WebKitWebsiteDataManager clearing is a follow-up (see PARITY.md).
  clearStorageData: () =>
    Promise.reject(
      new UnsupportedPlatformError('session.clearStorageData is not yet wired on Linux'),
    ),
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
  throw new UnsupportedPlatformError(`session is not supported on ${currentPlatform()} yet`);
};

/** Override the native session backend. Test-only. */
export const setSessionBackendForTesting = (fake: SessionBackend | undefined): void => {
  backend = fake;
};

export class Session {
  #userAgent = '';

  /** The session's User-Agent override, or `''` when none is set. */
  getUserAgent(): string {
    return this.#userAgent;
  }

  /** Set the default User-Agent applied to web contents created after this call. */
  setUserAgent(userAgent: string): void {
    this.#userAgent = userAgent;
  }

  /**
   * Clear all of the session's website data (cache, cookies, local/session
   * storage, IndexedDB, …). macOS only for now; rejects on Linux.
   */
  clearStorageData(): Promise<void> {
    return getBackend().clearStorageData();
  }

  /** Clear the override (revert to the platform default). Test-only convenience. */
  resetForTesting(): void {
    this.#userAgent = '';
  }
}

/** The `session` module — exposes the default session (Electron's `session.defaultSession`). */
export const session: { readonly defaultSession: Session } = {
  defaultSession: new Session(),
};
