import { type Pointer, ptr, read, toArrayBuffer } from 'bun:ffi';
import { randomBytes } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FFIError } from '../../../common/errors';
import type { KeyringBackend } from '../../api/safe-storage';
import { CRYPTPROTECT_UI_FORBIDDEN, loadCrypt32 } from './win32-crypt-ffi';
import { loadKernel32 } from './win32-ffi';

// The AES key never touches disk in the clear: only its DPAPI seal (bound to the Windows
// user) is stored (D036).

const KEY_LENGTH = 32;
const KEY_FILE = 'safestorage.key';

/** `DATA_BLOB { DWORD cbData; BYTE* pbData; }` on x64. */
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

/** Run one DPAPI call over `data`, copying out and `LocalFree`ing the system-allocated result. */
const dpapiTransform = (
  fn: (inPtr: ReturnType<typeof ptr>, outPtr: ReturnType<typeof ptr>) => number,
  data: Uint8Array,
  label: string,
): Uint8Array => {
  const inBlob = inputBlob(data);
  const outBlob = new Uint8Array(BLOB_SIZE);
  const outPtr = ptr(outBlob);
  if (fn(ptr(inBlob), outPtr) === 0) {
    throw new FFIError(`safeStorage: ${label} failed`);
  }
  // Native writes land behind ptr(): read them via read.*, never the JS array (CODEMAP).
  const size = read.u32(outPtr, 0);
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

/**
 * Read the sealed key at `path`, creating it on first use. The key file is shared by every
 * Bunmaska app of the user, so a first run publishes with an exclusive hard link and then
 * reads back whichever key won (D036): overwriting would orphan the loser's ciphertexts.
 */
export const loadOrCreateSealedKey = (
  path: string,
  seal: (key: Uint8Array) => Uint8Array,
  unseal: (sealed: Uint8Array) => Uint8Array,
): Buffer => {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const staged = `${path}.${process.pid}.tmp`;
    writeFileSync(staged, seal(randomBytes(KEY_LENGTH)));
    try {
      linkSync(staged, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    } finally {
      unlinkSync(staged);
    }
  }
  return Buffer.from(unseal(readFileSync(path)));
};

export const windowsDpapiBackend: KeyringBackend = {
  // DPAPI ships with every Windows install.
  isAvailable: (): boolean => true,

  getOrCreateKey: (): Buffer => loadOrCreateSealedKey(keyFilePath(), dpapiProtect, dpapiUnprotect),
};
