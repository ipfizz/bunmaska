import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { winLibraryAccessor } from './win32';

/**
 * Predefined `HKEY` roots are pointer-width handles whose 32-bit constants are
 * sign-extended to 64 bits (the same handle discipline as `win32.ts`): e.g.
 * `HKEY_CURRENT_USER` is `((HKEY)(LONG)0x80000001)` -> `0xFFFFFFFF80000001`.
 */
const ADVAPI32_SYMBOLS = {
  // (HKEY, LPCWSTR subKey, LPCWSTR value, DWORD flags, LPDWORD type,
  //  PVOID data, LPDWORD cbData) -> LONG (0 = ERROR_SUCCESS)
  RegGetValueW: {
    args: [
      FFIType.u64,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u32,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
} as const;

export const HKEY_CURRENT_USER = 0xffffffff80000001n;
export const RRF_RT_REG_DWORD = 0x00000010;

/** Open advapi32.dll and return its registry symbol table. Memoised; Windows-only. */
export const loadAdvapi32 = winLibraryAccessor('advapi32', () =>
  dlopen('advapi32.dll', ADVAPI32_SYMBOLS),
);
