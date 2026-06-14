import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { linuxLibsecretBackend } from '../../../src/main/platform/linux/libsecret-keyring';
import {
  LIBSECRET_FFI_SYMBOLS,
  loadLibsecretFFI,
} from '../../../src/main/platform/linux/libsecret-ffi';

// Verifies the libsecret library + symbol NAMES resolve under xvfb (dlopen of the
// whole table), and that isAvailable() is FALSE + non-blocking in CI: the
// BUNMASKA_ENABLE_LINUX_KEYRING gate is unset, so the blocking D-Bus store/lookup
// path is never reached (no keyring daemon is installed — by design).
if (currentPlatform() === 'linux') {
  describe('libsecret safeStorage backend (Linux)', () => {
    test('the libsecret simple-password symbols resolve', () => {
      const lib = loadLibsecretFFI();
      for (const name of Object.keys(LIBSECRET_FFI_SYMBOLS) as Array<
        keyof typeof LIBSECRET_FFI_SYMBOLS
      >) {
        expect(typeof lib.symbols[name]).toBe('function');
      }
    });

    test('isAvailable() returns false without the env gate and never blocks', () => {
      // The gate is unset in CI → no keyring round-trip is attempted.
      expect(process.env['BUNMASKA_ENABLE_LINUX_KEYRING']).not.toBe('1');
      expect(linuxLibsecretBackend.isAvailable()).toBe(false);
    });
  });
}
