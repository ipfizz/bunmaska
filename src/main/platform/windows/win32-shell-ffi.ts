import { dlopen, FFIType } from 'bun:ffi';
import { winLibraryAccessor } from './win32';

/**
 * shell32.dll desktop-integration FFI for the Windows `shell` backend.
 * `ShellExecuteW` is the flat-C verb-dispatcher (open a URL/file, reveal an item
 * in Explorer) — no COM. It returns an `HINSTANCE`-typed status: a value GREATER
 * than 32 means success; 0–32 is an `SE_ERR_*` failure code.
 */
const SHELL32_SYMBOLS = {
  // (HWND, LPCWSTR verb, LPCWSTR file, LPCWSTR params, LPCWSTR dir, INT show)
  //  -> HINSTANCE (as an integer; > 32 means success)
  ShellExecuteW: {
    args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32],
    returns: FFIType.u64,
  },
  // (DWORD dwMessage, PNOTIFYICONDATAW) -> BOOL — add/modify/delete a tray icon.
  Shell_NotifyIconW: { args: [FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  // (LPBROWSEINFOW) -> PIDLIST_ABSOLUTE — the legacy folder picker (no COM vtables).
  SHBrowseForFolderW: { args: [FFIType.ptr], returns: FFIType.u64 },
  // (PCIDLIST_ABSOLUTE pidl, LPWSTR path) -> BOOL — resolve a PIDL to a filesystem path.
  SHGetPathFromIDListW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
} as const;

/** `SW_SHOWNORMAL` — show the launched window in its normal state. */
export const SW_SHOWNORMAL = 1;
/** `ShellExecuteW` returns an HINSTANCE > this value on success. */
export const SHELL_EXECUTE_SUCCESS_THRESHOLD = 32n;

/** Open shell32.dll and return its symbol table. Memoised; Windows-only. */
export const loadShell32 = winLibraryAccessor('shell32', () =>
  dlopen('shell32.dll', SHELL32_SYMBOLS),
);
