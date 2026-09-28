import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BunmaskaError, InvalidArgumentError } from '../../common/errors';
import { service } from '../platform/index';
import type { KeyringBackend } from '../platform/services';

/**
 * AES-256-GCM under a keyring-held key (a DPAPI-sealed file on Windows), with no plaintext
 * fallback when there is no keyring (D036). Blobs are Bunmaska's own format, not Electron's.
 */

export type SafeStorage = {
  /** Never throws. */
  isEncryptionAvailable(): boolean;
  /** `plainText` is UTF-8. Throws when encryption is unavailable. */
  encryptString(plainText: string): Buffer;
  /** Throws on tamper, bad format or unavailability; never returns garbage. */
  decryptString(encrypted: Buffer): string;
};

const KEY_LENGTH = 32;
/** 96-bit IV: the GCM standard and its fastest path. */
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
/** Bumped when the layout changes, so a future format can co-exist. */
const VERSION = 0x01;
const MIN_BLOB_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

/** Blob layout `[version:1][iv:12][ciphertext:N][tag:16]`; a fresh random IV every time. */
const encryptWithKey = (key: Buffer, plainText: string): Buffer => {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, ciphertext, tag]);
};

const decryptWithKey = (key: Buffer, blob: Buffer): string => {
  if (blob.length < MIN_BLOB_LENGTH) {
    throw new InvalidArgumentError('safeStorage: corrupt blob (too short)');
  }
  if (blob[0] !== VERSION) {
    throw new InvalidArgumentError(
      `safeStorage: unsupported blob version 0x${blob[0]?.toString(16)}`,
    );
  }
  const iv = blob.subarray(1, 1 + IV_LENGTH);
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const ciphertext = blob.subarray(1 + IV_LENGTH, blob.length - TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // GCM final() throws on tamper or a wrong key: never return unauthenticated plaintext.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

let cachedKey: Buffer | undefined;
let cachedAvailable: boolean | undefined;
const { get: getBackend, setForTesting } = service('safeStorage');

/** Probed once then memoised, as Electron caches at startup. */
const isAvailable = (): boolean => {
  if (cachedAvailable === undefined) {
    cachedAvailable = getBackend().isAvailable();
  }
  return cachedAvailable;
};

/** Read the keyring once per process: on Linux it is the one blocking D-Bus call. */
const getKey = (): Buffer => {
  if (cachedKey === undefined) {
    const key = getBackend().getOrCreateKey();
    if (key.length !== KEY_LENGTH) {
      throw new BunmaskaError(
        `safeStorage: keyring returned a ${key.length}-byte key, expected ${KEY_LENGTH}`,
      );
    }
    cachedKey = key;
  }
  return cachedKey;
};

/** Also clears the cached key and availability. @internal */
export const setSafeStorageBackendForTesting = (fake: KeyringBackend | undefined): void => {
  setForTesting(fake);
  cachedKey = undefined;
  cachedAvailable = undefined;
};

export const safeStorage: SafeStorage = {
  isEncryptionAvailable() {
    return isAvailable();
  },
  encryptString(plainText) {
    if (!isAvailable()) {
      throw new BunmaskaError('safeStorage: encryption is not available (no OS keyring)');
    }
    return encryptWithKey(getKey(), plainText);
  },
  decryptString(encrypted) {
    if (!isAvailable()) {
      throw new BunmaskaError('safeStorage: encryption is not available (no OS keyring)');
    }
    return decryptWithKey(getKey(), encrypted);
  },
};
