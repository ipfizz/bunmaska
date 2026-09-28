import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { winLibraryAccessor } from './win32';

const SHELL32_SYMBOLS = {
  // (HWND, LPCWSTR verb, LPCWSTR file, LPCWSTR params, LPCWSTR dir, INT show)
  //  -> HINSTANCE as a status: above 32 is success, 0-32 an SE_ERR_* code
  ShellExecuteW: {
    args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32],
    returns: FFIType.u64,
  },
  // (DWORD dwMessage, PNOTIFYICONDATAW) -> BOOL
  Shell_NotifyIconW: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  // (LPBROWSEINFOW) -> PIDLIST_ABSOLUTE: the legacy folder picker, free of COM vtables
  SHBrowseForFolderW: { args: [FFIType.ptr], returns: FFIType.u64 },
  // (PCIDLIST_ABSOLUTE pidl, LPWSTR path) -> BOOL
  SHGetPathFromIDListW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
} as const;

export const SW_SHOWNORMAL = 1;
export const SHELL_EXECUTE_SUCCESS_THRESHOLD = 32n;

/** Open shell32.dll and return its symbol table. Memoised; Windows-only. */
export const loadShell32 = winLibraryAccessor('shell32', () =>
  dlopen('shell32.dll', SHELL32_SYMBOLS),
);
