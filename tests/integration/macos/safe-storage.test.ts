import { afterEach, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  deleteMacosKeychainItem,
  makeMacosKeychainBackend,
} from '../../../src/main/platform/macos/cocoa-safe-storage';
import { secConstants } from '../../../src/main/platform/macos/security-ffi';

// Exercises the REAL login Keychain under a PROBE item so the production
// 'dev.bunmaska.safeStorage' key is never touched. GitHub's macOS runners run in an
// unlocked login session, so SecItemAdd/CopyMatching/Delete complete without a
// prompt (verified on the arm64 host during design).
const PROBE_SERVICE = 'dev.bunmaska.safeStorage.integration-probe';
const PROBE_ACCOUNT = 'master-key-probe';

if (currentPlatform() === 'macos') {
  describe('cocoa-safe-storage (real Keychain)', () => {
    afterEach(() => {
      deleteMacosKeychainItem(PROBE_SERVICE, PROBE_ACCOUNT);
    });

    test('the kSec* / kCFBoolean constants resolve to distinct non-null CFTypeRefs', () => {
      const k = secConstants();
      const values = Object.values(k);
      expect(values.every((v) => v !== 0n)).toBe(true);
      expect(new Set(values).size).toBe(values.length);
    });

    test('getOrCreateKey creates then returns the SAME 32-byte key', () => {
      const backend = makeMacosKeychainBackend(PROBE_SERVICE, PROBE_ACCOUNT);
      expect(backend.isAvailable()).toBe(true);
      const first = backend.getOrCreateKey();
      const second = backend.getOrCreateKey();
      expect(first.length).toBe(32);
      expect(first.equals(second)).toBe(true);
    });
  });
}
