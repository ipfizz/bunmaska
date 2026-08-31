import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BunmaskaError, InvalidArgumentError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { linuxLibsecretBackend } from '../platform/linux/libsecret-keyring';
import { macosKeychainBackend } from '../platform/macos/cocoa-safe-storage';
import { windowsDpapiBackend } from '../platform/windows/windows-safe-storage';

/**
 * Encryption of strings tied to an OS-protected key — the drop-in equivalent of
 * Electron's `safeStorage`. The key is a random 32 bytes kept in the OS keyring
 * and never written to disk by Bunmaska; strings are sealed with AES-256-GCM.
 *
 * DIVERGENCE FROM ELECTRON, deliberate: Electron falls back to a `basic_text`
 * scheme (an obfuscated, effectively-plaintext key) when no OS keyring exists.
 * Bunmaska does NOT — a key sitting next to the ciphertext is not protection.
 * With no keyring, `isEncryptionAvailable()` is `false` and encrypt/decrypt
 * throw. Blobs are NOT Electron-compatible: the format is native and versioned.
 */

export type SafeStorage = {
  /** Never throws. */
  isEncryptionAvailable(): boolean;
  /** `plainText` is UTF-8. Throws when encryption is unavailable. */
  encryptString(plainText: string): Buffer;
  /** Throws on tamper, bad format, or unavailability — never returns garbage. */
  decryptString(encrypted: Buffer): string;
};

export type KeyringBackend = {
  /** MUST be cheap, non-blocking, and never throw. */
  isAvailable(): boolean;
  /** Exactly 32 bytes. May throw; the throw is surfaced by encrypt/decrypt. */
  getOrCreateKey(): Buffer;
};

const KEY_LENGTH = 32;
/** 96-bit IV: the GCM standard and its fastest path. */
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
/** Bumped when the layout changes, so a future format can co-exist. */
const VERSION = 0x01;
/** Version + IV + zero-length ciphertext + tag. */
const MIN_BLOB_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

/**
 * Blob layout: `[version:1][iv:12][ciphertext:N][tag:16]`. A random IV per
 * encryption (never reused) + the GCM tag make the blob tamper-evident.
 */
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
  // GCM auth failure (tamper / wrong key) makes final() THROW — surface it loudly,
  // never return garbage plaintext.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

const unavailableBackend: KeyringBackend = {
  isAvailable: () => false,
  getOrCreateKey: () => {
    throw new BunmaskaError(`safeStorage has no keyring backend on ${currentPlatform()}`);
  },
};

let backend: KeyringBackend | undefined;
let cachedKey: Buffer | undefined;
let cachedAvailable: boolean | undefined;

const getBackend = (): KeyringBackend => {
  if (backend !== undefined) {
    return backend;
  }
  const platform = currentPlatform();
  if (platform === 'macos') {
    return macosKeychainBackend;
  }
  if (platform === 'linux') {
    return linuxLibsecretBackend;
  }
  if (platform === 'windows') {
    return windowsDpapiBackend;
  }
  return unavailableBackend;
};

/** Probed once then memoised, as Electron caches at startup. */
const isAvailable = (): boolean => {
  if (cachedAvailable === undefined) {
    cachedAvailable = getBackend().isAvailable();
  }
  return cachedAvailable;
};

/**
 * Read the keyring ONCE per process: only the first op pays the round-trip — on
 * Linux, the one blocking D-Bus call.
 */
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
  backend = fake;
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
