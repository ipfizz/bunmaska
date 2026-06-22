import { type Pointer, ptr, read, toArrayBuffer } from 'bun:ffi';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FFIError } from '../../../common/errors';
import type { KeyringBackend } from '../../api/safe-storage';
import { CRYPTPROTECT_UI_FORBIDDEN, loadCrypt32 } from './win32-crypt-ffi';
import { loadKernel32 } from './win32-ffi';

/**
 * Windows `safeStorage` keyring backend — the WinCairo peer of the macOS Keychain
 * and Linux libsecret backends. Windows has no secret-service daemon, so the
 * 32-byte AES key is sealed with DPAPI (`CryptProtectData`, bound to the current
 * Windows user) and the sealed blob is persisted under the per-user Bunmaska home;
 * the key itself never touches disk in the clear. DPAPI is always present, so
 * `isAvailable` is unconditionally true (matching Electron's Windows behaviour).
 */

const KEY_LENGTH = 32;
const KEY_FILE = 'safestorage.key';

/** Offsets into a `DATA_BLOB { DWORD cbData; BYTE* pbData; }` (x64: 16 bytes). */
const BLOB_SIZE = 16;
const BLOB_PBDATA_OFFSET = 8;

/** The DPAPI-sealed key's on-disk location (per-user; honours `BUNMASKA_HOME`). */
const keyFilePath = (): string => {
  const home = process.env['BUNMASKA_HOME'] ?? join(homedir(), '.bunmaska');
  return join(home, KEY_FILE);
};

/** Build an input `DATA_BLOB` pointing at `data` (kept alive by the caller). */
const inputBlob = (data: Uint8Array): Uint8Array => {
  const blob = new Uint8Array(BLOB_SIZE);
  const view = new DataView(blob.buffer);
  view.setUint32(0, data.length, true);
  view.setBigUint64(BLOB_PBDATA_OFFSET, BigInt(ptr(data)), true);
  return blob;
};

/**
 * Run one DPAPI transform (`CryptProtectData`/`CryptUnprotectData`, both share
 * the blob in/out shape) over `data` and copy the system-allocated output out,
 * freeing it with `LocalFree`. `read.*` reads the output blob straight from the
 * native pointer (a `DataView` over the JS buffer would not see the native write).
 */
const dpapiTransform = (
  fn: (inPtr: ReturnType<typeof ptr>, outPtr: ReturnType<typeof ptr>) => number,
  data: Uint8Array,
  label: string,
): Uint8Array => {
  const inBlob = inputBlob(data); // `data` stays referenced through the call
  const outBlob = new Uint8Array(BLOB_SIZE);
  const outPtr = ptr(outBlob);
  if (fn(ptr(inBlob), outPtr) === 0) {
    throw new FFIError(`safeStorage: ${label} failed`);
  }
  const size = read.u32(outPtr, 0);
  // `read.ptr` yields the raw pointer value as a number; it IS a native address.
  const dataPtr = read.ptr(outPtr, BLOB_PBDATA_OFFSET) as Pointer;
  const result = new Uint8Array(toArrayBuffer(dataPtr, 0, size)).slice();
  loadKernel32().symbols.LocalFree(BigInt(dataPtr));
  return result;
};

/** Seal `data` to the current Windows user with DPAPI. Exported for integration tests. */
export const dpapiProtect = (data: Uint8Array): Uint8Array =>
  dpapiTransform(
    (inPtr, outPtr) =>
      loadCrypt32().symbols.CryptProtectData(
        inPtr,
        null,
        null,
        null,
        null,
        CRYPTPROTECT_UI_FORBIDDEN,
        outPtr,
      ),
    data,
    'CryptProtectData',
  );

/** Open a DPAPI blob produced by {@link dpapiProtect}. Throws on a wrong user/tamper. */
export const dpapiUnprotect = (data: Uint8Array): Uint8Array =>
  dpapiTransform(
    (inPtr, outPtr) =>
      loadCrypt32().symbols.CryptUnprotectData(
        inPtr,
        null,
        null,
        null,
        null,
        CRYPTPROTECT_UI_FORBIDDEN,
        outPtr,
      ),
    data,
    'CryptUnprotectData',
  );

export const windowsDpapiBackend: KeyringBackend = {
  // DPAPI ships with every Windows install — the key can always be sealed.
  isAvailable: (): boolean => true,

  getOrCreateKey: (): Buffer => {
    const path = keyFilePath();
    if (existsSync(path)) {
      return Buffer.from(dpapiUnprotect(readFileSync(path)));
    }
    const key = randomBytes(KEY_LENGTH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, dpapiProtect(key));
    return key;
  },
};
