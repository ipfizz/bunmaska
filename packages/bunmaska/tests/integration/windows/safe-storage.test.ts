import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentPlatform } from '../../../src/common/platform';
import { safeStorage, setSafeStorageBackendForTesting } from '../../../src/main/api/safe-storage';
import {
  dpapiProtect,
  dpapiUnprotect,
  windowsDpapiBackend,
} from '../../../src/main/platform/windows/windows-safe-storage';

/**
 * Windows `safeStorage` against real DPAPI (crypt32). Sealing is round-trip
 * testable IN-PROCESS (the same user unseals what it sealed), and the keyring's
 * key file is redirected to a temp dir via BUNMASKA_HOME so the test never touches
 * the developer's real `~/.bunmaska`. Runs only on a Windows host; inert elsewhere.
 */
if (currentPlatform() === 'windows') {
  describe('Windows safeStorage (DPAPI)', () => {
    let home: string;
    let priorHome: string | undefined;

    beforeAll(() => {
      home = mkdtempSync(join(tmpdir(), 'bunmaska-safestorage-'));
      priorHome = process.env['BUNMASKA_HOME'];
      process.env['BUNMASKA_HOME'] = home;
    });

    afterAll(() => {
      if (priorHome === undefined) {
        delete process.env['BUNMASKA_HOME'];
      } else {
        process.env['BUNMASKA_HOME'] = priorHome;
      }
      setSafeStorageBackendForTesting(undefined); // clear the cached key
      rmSync(home, { recursive: true, force: true });
    });

    test('DPAPI seals and unseals bytes (and the sealed blob is not the plaintext)', () => {
      const secret = new TextEncoder().encode('a 32-byte-ish secret payload!!!');
      const sealed = dpapiProtect(secret);
      expect(sealed.length).toBeGreaterThan(secret.length); // DPAPI envelope overhead
      expect(Buffer.from(sealed)).not.toEqual(Buffer.from(secret));
      expect(Buffer.from(dpapiUnprotect(sealed))).toEqual(Buffer.from(secret));
    });

    test('getOrCreateKey returns a stable 32-byte key and persists it sealed', () => {
      const first = windowsDpapiBackend.getOrCreateKey();
      expect(first).toHaveLength(32);
      expect(existsSync(join(home, 'safestorage.key'))).toBe(true);
      // A second call reads the persisted (sealed) key back to the same bytes.
      expect(windowsDpapiBackend.getOrCreateKey()).toEqual(first);
    });

    test('isAvailable is true (DPAPI is always present on Windows)', () => {
      expect(windowsDpapiBackend.isAvailable()).toBe(true);
    });

    test('the public safeStorage encrypts and decrypts end-to-end via DPAPI', () => {
      setSafeStorageBackendForTesting(undefined); // use the real Windows backend
      expect(safeStorage.isEncryptionAvailable()).toBe(true);
      const blob = safeStorage.encryptString('hunter2 — 🔐');
      expect(blob.length).toBeGreaterThan(0);
      expect(safeStorage.decryptString(blob)).toBe('hunter2 — 🔐');
    });
  });
}
