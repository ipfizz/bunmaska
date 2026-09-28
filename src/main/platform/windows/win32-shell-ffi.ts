import { FFIType } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { winLibraryAccessor, wstr } from './win32';

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

export const NIM_ADD = 0;
export const NIM_MODIFY = 1;
export const NIM_DELETE = 2;
const NIF_MESSAGE = 0x1;
const NIF_ICON = 0x2;
const NIF_TIP = 0x4;
const NIF_INFO = 0x10;

/** `sizeof(NOTIFYICONDATAW)` (current version, x64) and the field offsets written below. */
const NID_SIZE = 976;
const NID_HWND_OFFSET = 8;
const NID_UID_OFFSET = 16;
const NID_FLAGS_OFFSET = 20;
const NID_CALLBACK_OFFSET = 24;
const NID_HICON_OFFSET = 32;
const NID_TIP_OFFSET = 40; // szTip[128]
const NID_INFO_OFFSET = 304; // szInfo[256]
const NID_INFO_TITLE_OFFSET = 820; // szInfoTitle[64]
const NID_INFO_FLAGS_OFFSET = 948; // dwInfoFlags

/** Copy `value` into a fixed WCHAR field, truncated so its NUL terminator still fits. */
const setWideField = (nid: Uint8Array, offset: number, value: string, wchars: number): void => {
  const bytes = wstr(value);
  nid.set(bytes.subarray(0, Math.min(bytes.length, (wchars - 1) * 2)), offset);
};

/** A tray icon (with `tip`) or a notification balloon (with `info`). */
export type NotifyIconFields = {
  readonly hwnd: bigint;
  readonly uid: number;
  readonly callbackMessage: number;
  readonly hIcon: bigint;
  readonly tip?: string;
  readonly info?: { readonly text: string; readonly title: string; readonly flags: number };
};

/** Build the `NOTIFYICONDATAW` that `Shell_NotifyIconW` takes. */
export const notifyIconData = (fields: NotifyIconFields): Uint8Array => {
  const nid = new Uint8Array(NID_SIZE);
  const view = new DataView(nid.buffer);
  view.setUint32(0, NID_SIZE, true); // cbSize
  view.setBigUint64(NID_HWND_OFFSET, fields.hwnd, true);
  view.setUint32(NID_UID_OFFSET, fields.uid, true);
  const flags =
    NIF_MESSAGE |
    NIF_ICON |
    (fields.tip !== undefined ? NIF_TIP : 0) |
    (fields.info !== undefined ? NIF_INFO : 0);
  view.setUint32(NID_FLAGS_OFFSET, flags, true);
  view.setUint32(NID_CALLBACK_OFFSET, fields.callbackMessage, true);
  view.setBigUint64(NID_HICON_OFFSET, fields.hIcon, true);
  if (fields.tip !== undefined) {
    setWideField(nid, NID_TIP_OFFSET, fields.tip, 128);
  }
  if (fields.info !== undefined) {
    setWideField(nid, NID_INFO_OFFSET, fields.info.text, 256);
    setWideField(nid, NID_INFO_TITLE_OFFSET, fields.info.title, 64);
    view.setUint32(NID_INFO_FLAGS_OFFSET, fields.info.flags, true);
  }
  return nid;
};

export const SW_SHOWNORMAL = 1;
export const SHELL_EXECUTE_SUCCESS_THRESHOLD = 32n;

/** Open shell32.dll and return its symbol table. Memoised; Windows-only. */
export const loadShell32 = winLibraryAccessor('shell32', () =>
  dlopen('shell32.dll', SHELL32_SYMBOLS),
);
