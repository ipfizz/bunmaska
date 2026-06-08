import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test } from 'bun:test';
import { InvalidArgumentError, SambarError } from '../../../../src/common/errors';
import {
  type KeyringBackend,
  safeStorage,
  setSafeStorageBackendForTesting,
} from '../../../../src/main/api/safe-storage';

/** A fake keyring holding a fixed in-memory key — no FFI, no real keyring. */
const makeFakeBackend = (
  key: Buffer = randomBytes(32),
): KeyringBackend & { keyCalls: () => number } => {
  let keyCalls = 0;
  return {
    isAvailable: () => true,
    getOrCreateKey: () => {
      keyCalls += 1;
      return key;
    },
    keyCalls: () => keyCalls,
  };
};

const fakeUnavailable: KeyringBackend = {
  isAvailable: () => false,
  getOrCreateKey: () => {
    throw new Error('keyring unavailable');
  },
};

afterEach(() => {
  setSafeStorageBackendForTesting(undefined);
});

describe('safeStorage crypto round-trip', () => {
  test('round-trips ASCII, Unicode, empty, and a long string', () => {
    setSafeStorageBackendForTesting(makeFakeBackend());
    for (const s of ['hello', 'café — 日本語 — 🎉', '', 'x'.repeat(100_000)]) {
      expect(safeStorage.decryptString(safeStorage.encryptString(s))).toBe(s);
    }
  });

  test('the blob is versioned with a fresh IV each time but decrypts the same', () => {
    setSafeStorageBackendForTesting(makeFakeBackend());
    const a = safeStorage.encryptString('secret');
    const b = safeStorage.encryptString('secret');
    expect(a[0]).toBe(0x01);
    expect(a.length).toBe(1 + 12 + Buffer.byteLength('secret') + 16);
    expect(a.equals(b)).toBe(false); // random IV → different ciphertext
    expect(safeStorage.decryptString(a)).toBe('secret');
    expect(safeStorage.decryptString(b)).toBe('secret');
  });
});

describe('safeStorage tamper + format detection', () => {
  test('a flipped ciphertext byte fails authentication', () => {
    setSafeStorageBackendForTesting(makeFakeBackend());
    const blob = safeStorage.encryptString('top secret');
    blob.writeUInt8(blob.readUInt8(15) ^ 0xff, 15); // a ciphertext byte (past version+IV)
    expect(() => safeStorage.decryptString(blob)).toThrow();
  });

  test('a flipped auth-tag byte fails authentication', () => {
    setSafeStorageBackendForTesting(makeFakeBackend());
    const blob = safeStorage.encryptString('top secret');
    const last = blob.length - 1;
    blob.writeUInt8(blob.readUInt8(last) ^ 0xff, last);
    expect(() => safeStorage.decryptString(blob)).toThrow();
  });

  test('a too-short blob throws InvalidArgumentError', () => {
    setSafeStorageBackendForTesting(makeFakeBackend());
    expect(() => safeStorage.decryptString(Buffer.alloc(10))).toThrow(InvalidArgumentError);
  });

  test('an unknown version byte throws InvalidArgumentError', () => {
    setSafeStorageBackendForTesting(makeFakeBackend());
    const blob = safeStorage.encryptString('x');
    blob[0] = 0x02;
    expect(() => safeStorage.decryptString(blob)).toThrow(InvalidArgumentError);
  });

  test('a blob from one key cannot be decrypted with a different key', () => {
    setSafeStorageBackendForTesting(makeFakeBackend(randomBytes(32)));
    const blob = safeStorage.encryptString('cross-key');
    setSafeStorageBackendForTesting(makeFakeBackend(randomBytes(32))); // new key + cleared cache
    expect(() => safeStorage.decryptString(blob)).toThrow();
  });
});

describe('safeStorage availability + dispatch', () => {
  test('isEncryptionAvailable reflects the backend and never throws', () => {
    setSafeStorageBackendForTesting(makeFakeBackend());
    expect(safeStorage.isEncryptionAvailable()).toBe(true);
    setSafeStorageBackendForTesting(fakeUnavailable);
    expect(safeStorage.isEncryptionAvailable()).toBe(false);
  });

  test('encrypt/decrypt throw SambarError when encryption is unavailable', () => {
    setSafeStorageBackendForTesting(fakeUnavailable);
    expect(() => safeStorage.encryptString('x')).toThrow(SambarError);
    expect(() => safeStorage.decryptString(Buffer.alloc(29))).toThrow(SambarError);
  });

  test('the keyring key is fetched exactly once and cached across ops', () => {
    const fake = makeFakeBackend();
    setSafeStorageBackendForTesting(fake);
    safeStorage.encryptString('a');
    safeStorage.encryptString('b');
    const blob = safeStorage.encryptString('c');
    safeStorage.decryptString(blob);
    expect(fake.keyCalls()).toBe(1);
  });

  test('a backend returning a wrong-length key throws with the real length', () => {
    setSafeStorageBackendForTesting({
      isAvailable: () => true,
      getOrCreateKey: () => Buffer.alloc(16),
    });
    expect(() => safeStorage.encryptString('x')).toThrow(/16-byte key, expected 32/);
  });
});
