---
title: "safeStorage"
description: "Encrypt and decrypt strings for on-disk storage using an OS-protected key (macOS Keychain / Linux libsecret / Windows DPAPI)."
order: 21
---

`safeStorage` encrypts and decrypts strings using a 32-byte key kept in the OS keyring (macOS Keychain, Linux libsecret) and never written to disk. On Windows, sealing is delegated to DPAPI (`CryptProtectData` / `CryptUnprotectData`) under the current user's credentials. Strings are sealed with AES-256-GCM, so the blob is authenticated - tampering with the ciphertext makes `decryptString` throw rather than return garbage.

Process: Main

One deliberate divergence from Electron: there is **no `basic_text` fallback**. Electron will, when no OS keyring is present, fall back to an obfuscated near-plaintext key stored alongside the ciphertext. bunmaska refuses to pretend that is encryption - with no keyring, `isEncryptionAvailable()` returns `false` and the encrypt/decrypt calls throw. The blob format is also bunmaska's own versioned layout (`[version:1][iv:12][ciphertext:N][tag:16]`); it is **not** interchangeable with Electron's encrypted blobs.

## Methods

### `safeStorage.isEncryptionAvailable()`

Returns `boolean` - whether a keyring-backed key is available, so `encryptString` / `decryptString` can run. Never throws. On macOS this is true when the Keychain is reachable; on Linux when libsecret is present; on Windows it returns `true` via DPAPI. On any host with no keyring (and no DPAPI) it returns `false`. The result is probed once and memoised for the process.

```ts
import { safeStorage } from 'bunmaska';

if (safeStorage.isEncryptionAvailable()) {
  // safe to encrypt/decrypt
} else {
  // no OS keyring - fall back to your own scheme or refuse to persist secrets
}
```

### `safeStorage.encryptString(plainText)`

* `plainText` string

Returns `Buffer` - an authenticated blob (version + random IV + ciphertext + GCM tag) representing the encrypted string. A fresh random IV is used on every call, so encrypting the same text twice yields different bytes. Throws if encryption is unavailable (no OS keyring).

```ts
import { safeStorage } from 'bunmaska';
import { writeFileSync } from 'node:fs';

const sealed = safeStorage.encryptString('my-api-token');
writeFileSync('/tmp/token.bin', sealed);
```

### `safeStorage.decryptString(encrypted)`

* `encrypted` Buffer

Returns `string` - the decrypted text. Opens a blob produced by `encryptString`. Throws if encryption is unavailable, if the blob is too short or has an unsupported version, or if GCM authentication fails (a tampered blob or a key mismatch). It never returns partial or unverified plaintext.

```ts
import { safeStorage } from 'bunmaska';
import { readFileSync } from 'node:fs';

const sealed = readFileSync('/tmp/token.bin');
const token = safeStorage.decryptString(sealed); // 'my-api-token'
```

## Not in bunmaska (yet)

The synchronous core (`isEncryptionAvailable` / `encryptString` / `decryptString`) is fully implemented. The rest of Electron's `safeStorage` surface is absent:

- **`encryptStringAsync` / `decryptStringAsync` / `isAsyncEncryptionAvailable`** - the entire async API with pluggable key providers, key rotation (`shouldReEncrypt`), and temporary-unavailability handling is not implemented. bunmaska does the one keyring round-trip lazily on first use and caches the key, so encrypt/decrypt after that are pure in-memory AES.
- **`getSelectedStorageBackend()`** (Electron's _Linux_ method) - there is no backend-name reporting; bunmaska uses libsecret on Linux and exposes no selector for kwallet variants.
- **`setUsePlainTextEncryption()`** - intentionally omitted. It exists in Electron to opt into the `basic_text` plaintext-key fallback, which bunmaska does not have by design.
