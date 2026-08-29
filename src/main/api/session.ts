/**
 * Session — a drop-in subset of Electron's `session` / `Session`.
 *
 * `setUserAgent(ua)` applies only to windows created AFTERWARD, at construction
 * (before their first navigation); change a live one with
 * `webContents.setUserAgent(ua)`. Kept free of a `BrowserWindow` import so it
 * can be read at window construction without a cycle.
 */

import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import * as macosWebsiteData from '../platform/macos/cocoa-website-data';
import { windowsSessionBackend } from '../platform/windows/windows-session';

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
  if (currentPlatform() === 'windows') {
    return windowsSessionBackend;
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

/** The `session` module — Electron's `session.defaultSession`. */
export const session: { readonly defaultSession: Session } = {
  defaultSession: new Session(),
};
