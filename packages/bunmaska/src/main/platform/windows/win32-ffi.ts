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
