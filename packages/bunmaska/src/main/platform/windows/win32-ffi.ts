import { dlopen, FFIType } from 'bun:ffi';
import { winLibraryAccessor } from './win32';

/**
 * Win32 windowing + message-pump FFI for the Windows backend (user32.dll and
 * kernel32.dll), the engine-agnostic half of the backend.
 *
 * Mirrors the macOS `cocoa-ffi`/`carbon-ffi` loaders: a memoised, import-safe
 * symbol table per system DLL. Both DLLs live in System32 and are always on the
 * loader search path, so they open by bare name.
 *
 * Handle discipline (see `win32.ts`): every `HWND`/`HINSTANCE`/`HMENU`/`HCURSOR`
 * is declared `u64` and carried as a `bigint`, NOT `ptr` — a Win32 handle is an
 * opaque kernel value, not a virtual address. Real pointers (the `WNDCLASSEXW`
 * and `MSG` struct buffers, wide strings) are passed as `ptr`.
 */

/** user32.dll — window classes, windows, and the message pump. */
const USER32_SYMBOLS = {
  // (const WNDCLASSEXW *) -> ATOM
  RegisterClassExW: { args: [FFIType.ptr], returns: FFIType.u16 },
  // (LPCWSTR className, HINSTANCE) -> BOOL
  UnregisterClassW: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  // (DWORD exStyle, LPCWSTR className, LPCWSTR windowName, DWORD style,
  //  int x, int y, int w, int h, HWND parent, HMENU menu, HINSTANCE, LPVOID param) -> HWND
  CreateWindowExW: {
    args: [
      FFIType.u32,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u32,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.u64,
      FFIType.u64,
      FFIType.u64,
      FFIType.ptr,
    ],
    returns: FFIType.u64,
  },
  // (HWND, UINT msg, WPARAM, LPARAM) -> LRESULT
  DefWindowProcW: {
    args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.i64,
  },
  // (HWND) -> BOOL
  DestroyWindow: { args: [FFIType.u64], returns: FFIType.i32 },
  // (HWND, int nCmdShow) -> BOOL
  ShowWindow: { args: [FFIType.u64, FFIType.i32], returns: FFIType.i32 },
  // (HWND) -> BOOL
  IsWindowVisible: { args: [FFIType.u64], returns: FFIType.i32 },
  // (HWND, LPCWSTR) -> BOOL
  SetWindowTextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (HWND, LPRECT) -> BOOL
  GetClientRect: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (HWND, int x, int y, int w, int h, BOOL repaint) -> BOOL
  MoveWindow: {
    args: [FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  // (LPMSG, HWND, UINT wMsgFilterMin, UINT wMsgFilterMax, UINT wRemoveMsg) -> BOOL
  PeekMessageW: {
    args: [FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.u32, FFIType.u32],
    returns: FFIType.i32,
  },
  // (const MSG *) -> BOOL
  TranslateMessage: { args: [FFIType.ptr], returns: FFIType.i32 },
  // (const MSG *) -> LRESULT
  DispatchMessageW: { args: [FFIType.ptr], returns: FFIType.i64 },
  // (int exitCode) -> void
  PostQuitMessage: { args: [FFIType.i32], returns: FFIType.void },
  // (HINSTANCE, LPCWSTR lpCursorName) -> HCURSOR
  LoadCursorW: { args: [FFIType.u64, FFIType.u64], returns: FFIType.u64 },
  // (HWND, UINT msg, WPARAM, LPARAM) -> LRESULT (synchronous dispatch to the WndProc)
  SendMessageW: {
    args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.i64,
  },
  // (HWND, UINT msg, WPARAM, LPARAM) -> BOOL — posts to the queue (the pump sees it)
  PostMessageW: {
    args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.i32,
  },
  // (HWND, HWND insertAfter, int x, int y, int cx, int cy, UINT flags) -> BOOL
  SetWindowPos: {
    args: [
      FFIType.u64,
      FFIType.u64,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.u32,
    ],
    returns: FFIType.i32,
  },
  // (HWND) -> BOOL — is the window minimised?
  IsIconic: { args: [FFIType.u64], returns: FFIType.i32 },
  // (HWND) -> BOOL — is the window maximised?
  IsZoomed: { args: [FFIType.u64], returns: FFIType.i32 },
  // (HWND, LPRECT) -> BOOL — the window's bounds in screen coordinates.
  GetWindowRect: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // (HWND) -> BOOL — bring the window to the foreground and focus it.
  SetForegroundWindow: { args: [FFIType.u64], returns: FFIType.i32 },
  // () -> HWND — the window the user is currently working with.
  GetForegroundWindow: { args: [], returns: FFIType.u64 },
  // (HWND, int nIndex) -> LONG_PTR — read a window style word (GWL_STYLE/EXSTYLE).
  GetWindowLongPtrW: { args: [FFIType.u64, FFIType.i32], returns: FFIType.i64 },
  // (HWND, int nIndex, LONG_PTR) -> LONG_PTR — write a window style word.
  SetWindowLongPtrW: { args: [FFIType.u64, FFIType.i32, FFIType.i64], returns: FFIType.i64 },
  // (HWND, COLORREF, BYTE alpha, DWORD flags) -> BOOL — per-window opacity.
  SetLayeredWindowAttributes: {
    args: [FFIType.u64, FFIType.u32, FFIType.u8, FFIType.u32],
    returns: FFIType.i32,
  },
  // (int nIndex) -> int — a system metric (e.g. primary screen width/height).
  GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },

  // ── Clipboard (used by the clipboard backend) ────────────────────────────
  // (HWND) -> BOOL — open the clipboard for the current task.
  OpenClipboard: { args: [FFIType.u64], returns: FFIType.i32 },
  // () -> BOOL — close it (release ownership of the open).
  CloseClipboard: { args: [], returns: FFIType.i32 },
  // () -> BOOL — empty + take ownership (the caller must hold it open).
  EmptyClipboard: { args: [], returns: FFIType.i32 },
  // (UINT format) -> HANDLE — the clipboard still OWNS the returned handle.
  GetClipboardData: { args: [FFIType.u32], returns: FFIType.u64 },
  // (UINT format, HANDLE) -> HANDLE — the clipboard TAKES ownership of the handle.
  SetClipboardData: { args: [FFIType.u32, FFIType.u64], returns: FFIType.u64 },
  // (UINT format) -> BOOL
  IsClipboardFormatAvailable: { args: [FFIType.u32], returns: FFIType.i32 },
  // (LPCWSTR) -> UINT — register/look up a named format (e.g. "HTML Format").
  RegisterClipboardFormatW: { args: [FFIType.ptr], returns: FFIType.u32 },
} as const;

/** kernel32.dll — the running module handle, DLL-search dir, and proc lookup. */
const KERNEL32_SYMBOLS = {
  // (LPCWSTR moduleName | NULL) -> HMODULE
  GetModuleHandleW: { args: [FFIType.ptr], returns: FFIType.u64 },
  // (LPCWSTR pathName | NULL) -> BOOL — adds one directory to the DLL search path.
  // The Windows substitute for $ORIGIN: it lets a bundled engine's WebKit2.dll
  // resolve its own dependency closure (ICU, libcurl, ...) from the engine dir.
  SetDllDirectoryW: { args: [FFIType.ptr], returns: FFIType.i32 },
  // (HMODULE, LPCSTR procName) -> FARPROC — used to get the address of the system
  // DefWindowProcW so a web-host child window can use it as a NATIVE window
  // procedure (a JSCallback WndProc cannot survive WebKit's re-entrant flood).
  GetProcAddress: { args: [FFIType.u64, FFIType.cstring], returns: FFIType.u64 },
  // (HANDLE process, UINT exitCode) -> BOOL — hard-terminate. Used to exit the
  // app WITHOUT running WebKit's static/DLL-detach teardown, which crashes.
  TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },

  // ── Movable global memory (clipboard transfer buffers) ───────────────────
  // (UINT uFlags, SIZE_T dwBytes) -> HGLOBAL
  GlobalAlloc: { args: [FFIType.u32, FFIType.u64], returns: FFIType.u64 },
  // (HGLOBAL) -> LPVOID — lock a movable block and get its real address.
  GlobalLock: { args: [FFIType.u64], returns: FFIType.ptr },
  // (HGLOBAL) -> BOOL
  GlobalUnlock: { args: [FFIType.u64], returns: FFIType.i32 },
  // (HGLOBAL) -> SIZE_T — the block's byte size.
  GlobalSize: { args: [FFIType.u64], returns: FFIType.u64 },
  // (HGLOBAL) -> HGLOBAL — free a block we still own (NULL on success).
  GlobalFree: { args: [FFIType.u64], returns: FFIType.u64 },
  // (HLOCAL) -> HLOCAL — free a block the system allocated for us (e.g. a DPAPI
  // CryptProtectData output blob), NULL on success.
  LocalFree: { args: [FFIType.u64], returns: FFIType.u64 },
} as const;

/** ole32.dll — COM/OLE, which WebKit's Windows port requires initialised per-thread. */
const OLE32_SYMBOLS = {
  // (LPVOID reserved) -> HRESULT
  OleInitialize: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const;

/** Open user32.dll and return its window + message-pump symbol table. Memoised. */
export const loadUser32 = winLibraryAccessor('user32', () => dlopen('user32.dll', USER32_SYMBOLS));

/** Open kernel32.dll and return its symbol table. Memoised. */
export const loadKernel32 = winLibraryAccessor('kernel32', () =>
  dlopen('kernel32.dll', KERNEL32_SYMBOLS),
);

/** Open ole32.dll and return its symbol table. Memoised. */
export const loadOle32 = winLibraryAccessor('ole32', () => dlopen('ole32.dll', OLE32_SYMBOLS));
