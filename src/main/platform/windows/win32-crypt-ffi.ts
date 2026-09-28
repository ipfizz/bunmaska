import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { winLibraryAccessor } from './win32';

/**
 * Both calls take and return a `DATA_BLOB { DWORD cbData; BYTE* pbData; }` (x64: 16 bytes,
 * `pbData` at 8). The output `pbData` is system-allocated: free it with `LocalFree`. The
 * unused description/entropy/reserved/prompt parameters are `ptr` so they can be `null`.
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

/** `CRYPTPROTECT_UI_FORBIDDEN`: fail instead of raising UI. */
export const CRYPTPROTECT_UI_FORBIDDEN = 0x1;

/** Open crypt32.dll and return its DPAPI symbol table. Memoised; Windows-only. */
export const loadCrypt32 = winLibraryAccessor('crypt32', () =>
  dlopen('crypt32.dll', CRYPT32_SYMBOLS),
);
