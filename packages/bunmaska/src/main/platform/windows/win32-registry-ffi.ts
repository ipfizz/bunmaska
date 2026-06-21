import { dlopen, FFIType } from 'bun:ffi';
import { winLibraryAccessor } from './win32';

/**
 * advapi32.dll registry reads for the Windows backend (e.g. the native-theme dark
 * mode preference). `RegGetValueW` is a flat-C export — no COM — that opens the
 * key, reads one value, and closes it in a single call.
 *
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

/** `HKEY_CURRENT_USER` — the predefined root, sign-extended to 64 bits. */
export const HKEY_CURRENT_USER = 0xffffffff80000001n;
/** `RRF_RT_REG_DWORD` — restrict `RegGetValueW` to a `REG_DWORD` value. */
export const RRF_RT_REG_DWORD = 0x00000010;

/** Open advapi32.dll and return its registry symbol table. Memoised; Windows-only. */
export const loadAdvapi32 = winLibraryAccessor('advapi32', () =>
  dlopen('advapi32.dll', ADVAPI32_SYMBOLS),
);
