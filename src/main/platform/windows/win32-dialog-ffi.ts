import { dlopen, FFIType } from 'bun:ffi';
import { winLibraryAccessor } from './win32';

/**
 * comdlg32.dll file-dialog FFI for the Windows `dialog` backend. `GetOpenFileNameW`
 * and `GetSaveFileNameW` are the flat-C legacy pickers (no COM) — each takes a
 * single `OPENFILENAMEW` struct by pointer and runs its own modal message loop,
 * returning `TRUE` when the user confirmed. The big struct is built field-by-field
 * in `windows-dialog.ts`; the offsets there match the x64 layout.
 */
const COMDLG32_SYMBOLS = {
  // (LPOPENFILENAMEW) -> BOOL
  GetOpenFileNameW: { args: [FFIType.ptr], returns: FFIType.i32 },
  // (LPOPENFILENAMEW) -> BOOL
  GetSaveFileNameW: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const;

/** Open comdlg32.dll and return its file-dialog symbol table. Memoised; Windows-only. */
export const loadComdlg32 = winLibraryAccessor('comdlg32', () =>
  dlopen('comdlg32.dll', COMDLG32_SYMBOLS),
);
