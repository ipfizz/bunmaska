import { dlopen, FFIType } from 'bun:ffi';
import { winLibraryAccessor } from './win32';

/**
 * DPAPI FFI (crypt32.dll) for the Windows `safeStorage` backend — the engine for
 * sealing the AES key to the current Windows user account.
 *
 * `CryptProtectData`/`CryptUnprotectData` are flat-C exports (no COM). Each takes
 * and returns a `DATA_BLOB { DWORD cbData; BYTE* pbData; }` (16 bytes on x64:
 * `cbData` at offset 0, `pbData` at offset 8). The output blob's `pbData` is
 * allocated by the system and must be released with `LocalFree` (see
 * `win32-ffi.ts`). The unused `LPCWSTR`/`DATA_BLOB*`/`PVOID`/prompt parameters are
 * declared `ptr` so they can be passed as `null`.
 */
const CRYPT32_SYMBOLS = {
  // (DATA_BLOB* in, LPCWSTR desc, DATA_BLOB* entropy, PVOID reserved,
  //  CRYPTPROTECT_PROMPTSTRUCT* prompt, DWORD flags, DATA_BLOB* out) -> BOOL
  CryptProtectData: {
    args: [
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u32,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
  // Same shape as CryptProtectData; reverses the seal.
  CryptUnprotectData: {
    args: [
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u32,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
} as const;

/** `CRYPTPROTECT_UI_FORBIDDEN` — never raise UI; fail instead (for a service/GUI app). */
export const CRYPTPROTECT_UI_FORBIDDEN = 0x1;

/** Open crypt32.dll and return its DPAPI symbol table. Memoised; Windows-only. */
export const loadCrypt32 = winLibraryAccessor('crypt32', () =>
  dlopen('crypt32.dll', CRYPT32_SYMBOLS),
);
