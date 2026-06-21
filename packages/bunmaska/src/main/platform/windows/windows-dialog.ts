import { ptr, read } from 'bun:ffi';
import { join } from 'node:path';
import type { DialogBackend } from '../../api/dialog';
import type { MessageBoxSpec, OpenDialogSpec, SaveDialogSpec } from '../macos/cocoa-dialog';
import { wstr } from './win32';
import { loadComdlg32 } from './win32-dialog-ffi';
import { loadOle32, loadUser32 } from './win32-ffi';
import { loadShell32 } from './win32-shell-ffi';

/**
 * Windows `dialog` backend, the WinCairo peer of the `NSAlert`/`NSOpenPanel`
 * (macOS) and GTK (Linux) backends. Message boxes use `MessageBoxW`; file pickers
 * use the flat-C `GetOpenFileNameW`/`GetSaveFileNameW` (`OPENFILENAMEW` struct);
 * the folder picker uses `SHBrowseForFolderW`. ALL of these are MODAL — they spin
 * their own message loop and block until the user dismisses them — so, exactly as
 * the macOS `runModal` path, the native calls cannot run on CI; only the pure
 * option→native mapping helpers below are unit-tested. (`MessageBoxW` shows a
 * fixed button set, not Electron's arbitrary labels — faithful custom buttons need
 * `TaskDialogIndirect`/comctl6, a follow-up.)
 */

// MessageBoxW button sets + icons.
const MB_OK = 0x0;
const MB_OKCANCEL = 0x1;
const MB_YESNOCANCEL = 0x3;
const MB_ICONERROR = 0x10;
const MB_ICONQUESTION = 0x20;
const MB_ICONWARNING = 0x30;
const MB_ICONINFORMATION = 0x40;
// MessageBoxW return ids (IDOK maps to index 0 implicitly — the "not cancel" case).
const IDCANCEL = 2;
const IDYES = 6;
const IDNO = 7;

// OPENFILENAMEW flags.
const OFN_HIDEREADONLY = 0x4;
const OFN_NOCHANGEDIR = 0x8;
const OFN_OVERWRITEPROMPT = 0x2;
const OFN_PATHMUSTEXIST = 0x800;
const OFN_FILEMUSTEXIST = 0x1000;
const OFN_ALLOWMULTISELECT = 0x200;
const OFN_EXPLORER = 0x80000;

// BROWSEINFOW flags.
const BIF_RETURNONLYFSDIRS = 0x1;
const BIF_NEWDIALOGSTYLE = 0x40;

/** `sizeof(OPENFILENAMEW)` (x64) and the field offsets used below. */
const OFN_SIZE = 152;
const OFN_FILTER_OFFSET = 24; // lpstrFilter
const OFN_FILTER_INDEX_OFFSET = 44; // nFilterIndex
const OFN_FILE_OFFSET = 48; // lpstrFile (output buffer)
const OFN_MAX_FILE_OFFSET = 56; // nMaxFile (in WCHARs)
const OFN_FLAGS_OFFSET = 96; // Flags
/** `sizeof(BROWSEINFOW)` (x64) and the field offsets used below. */
const BI_SIZE = 64;
const BI_DISPLAY_NAME_OFFSET = 16; // pszDisplayName
const BI_TITLE_OFFSET = 24; // lpszTitle
const BI_FLAGS_OFFSET = 32; // ulFlags

/** Output buffer size (WCHARs) — large enough for a multi-select result list. */
const FILE_BUFFER_WCHARS = 32768;
const MAX_PATH_WCHARS = 260;

/**
 * Map a message-box spec to a `MessageBoxW` `uType` (button set + icon). Electron
 * allows arbitrary button labels; `MessageBoxW` only has fixed sets, so the count
 * picks the closest set (1→OK, 2→OK/Cancel, 3→Yes/No/Cancel, >3→OK). Pure.
 */
export const messageBoxUType = (spec: MessageBoxSpec): number => {
  const count = spec.buttons.length;
  const buttons = count === 2 ? MB_OKCANCEL : count >= 3 ? MB_YESNOCANCEL : MB_OK;
  const icon =
    spec.type === 'error'
      ? MB_ICONERROR
      : spec.type === 'question'
        ? MB_ICONQUESTION
        : spec.type === 'warning'
          ? MB_ICONWARNING
          : spec.type === 'info'
            ? MB_ICONINFORMATION
            : 0;
  return buttons | icon;
};

/** Map a `MessageBoxW` return id back to the clicked button index for `buttonCount`. Pure. */
export const messageBoxResponse = (buttonCount: number, id: number): number => {
  if (buttonCount >= 3) {
    return id === IDYES ? 0 : id === IDNO ? 1 : 2; // Yes / No / Cancel
  }
  if (buttonCount === 2) {
    return id === IDCANCEL || id === IDNO ? 1 : 0; // OK/Yes → 0, Cancel/No → 1
  }
  return 0; // single OK button
};

/**
 * Build the `OPENFILENAMEW` filter string from extensions (no dots): a NUL-
 * separated `Display\0pattern\0…` list ending in a single NUL (the wide-string
 * encoder adds the terminating second NUL). Empty extensions → "All Files". Pure.
 */
export const buildFileFilter = (extensions: ReadonlyArray<string>): string => {
  if (extensions.length === 0) {
    return 'All Files (*.*)\0*.*\0';
  }
  const patterns = extensions.map((ext) => `*.${ext}`).join(';');
  return `Files (${patterns})\0${patterns}\0All Files (*.*)\0*.*\0`;
};

/**
 * Parse a `GetOpenFileNameW` result (NUL-separated, read up to the double-NUL)
 * into absolute paths. One segment = a single file; multiple = a directory
 * followed by file names (multi-select), joined back into full paths. Pure.
 */
export const parseSelectedPaths = (decoded: string): string[] => {
  const parts = decoded.split('\0').filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return parts;
  }
  const [directory, ...names] = parts;
  return names.map((name) => join(directory ?? '', name));
};

/** Read a NUL-separated wide-string list from native memory up to its double-NUL. */
const readResultString = (bufferPtr: ReturnType<typeof ptr>, maxWchars: number): string => {
  const units: number[] = [];
  for (let i = 0; i < maxWchars; i += 1) {
    const unit = read.u16(bufferPtr, i * 2);
    if (unit === 0 && read.u16(bufferPtr, (i + 1) * 2) === 0) {
      break; // double NUL terminates the list
    }
    units.push(unit);
  }
  return String.fromCharCode(...units);
};

/** Read a single NUL-terminated wide string from native memory. */
const readPathString = (bufferPtr: ReturnType<typeof ptr>, maxWchars: number): string => {
  const units: number[] = [];
  for (let i = 0; i < maxWchars; i += 1) {
    const unit = read.u16(bufferPtr, i * 2);
    if (unit === 0) {
      break;
    }
    units.push(unit);
  }
  return String.fromCharCode(...units);
};

/** Run a `GetOpenFileNameW`/`GetSaveFileNameW`-shaped call and return the chosen path(s). */
const runFileDialog = (
  call: (ofnPtr: ReturnType<typeof ptr>) => number,
  extensions: ReadonlyArray<string>,
  flags: number,
  defaultName: string,
): string[] => {
  const filterBuffer = wstr(buildFileFilter(extensions));
  const fileBuffer = new Uint8Array(FILE_BUFFER_WCHARS * 2);
  if (defaultName.length > 0) {
    const name = wstr(defaultName);
    fileBuffer.set(name.subarray(0, Math.min(name.length, FILE_BUFFER_WCHARS * 2 - 2)), 0);
  }
  const fileBufferPtr = ptr(fileBuffer);
  const ofn = new Uint8Array(OFN_SIZE);
  const view = new DataView(ofn.buffer);
  view.setUint32(0, OFN_SIZE, true); // lStructSize
  view.setBigUint64(OFN_FILTER_OFFSET, BigInt(ptr(filterBuffer)), true);
  view.setUint32(OFN_FILTER_INDEX_OFFSET, 1, true);
  view.setBigUint64(OFN_FILE_OFFSET, BigInt(fileBufferPtr), true);
  view.setUint32(OFN_MAX_FILE_OFFSET, FILE_BUFFER_WCHARS, true);
  view.setUint32(OFN_FLAGS_OFFSET, flags, true);
  if (call(ptr(ofn)) === 0) {
    return []; // the user cancelled
  }
  return parseSelectedPaths(readResultString(fileBufferPtr, FILE_BUFFER_WCHARS));
};

/** Show the legacy folder picker, returning the chosen directory or `[]` on cancel. */
const runFolderDialog = (): string[] => {
  const titleBuffer = wstr('Select Folder');
  const displayBuffer = new Uint8Array(MAX_PATH_WCHARS * 2);
  const bi = new Uint8Array(BI_SIZE);
  const view = new DataView(bi.buffer);
  view.setBigUint64(BI_DISPLAY_NAME_OFFSET, BigInt(ptr(displayBuffer)), true);
  view.setBigUint64(BI_TITLE_OFFSET, BigInt(ptr(titleBuffer)), true);
  view.setUint32(BI_FLAGS_OFFSET, BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE, true);
  const shell32 = loadShell32().symbols;
  const pidl = shell32.SHBrowseForFolderW(ptr(bi));
  if (pidl === 0n) {
    return [];
  }
  const pathBuffer = new Uint8Array(MAX_PATH_WCHARS * 2);
  const pathBufferPtr = ptr(pathBuffer);
  const ok = shell32.SHGetPathFromIDListW(pidl, pathBufferPtr);
  loadOle32().symbols.CoTaskMemFree(pidl); // the shell allocated the PIDL
  return ok === 0 ? [] : [readPathString(pathBufferPtr, MAX_PATH_WCHARS)];
};

export const windowsDialogBackend: DialogBackend = {
  showMessageBox(spec: MessageBoxSpec): number {
    const text = spec.detail.length > 0 ? `${spec.message}\n\n${spec.detail}` : spec.message;
    const textBuffer = wstr(text);
    const captionBuffer = wstr('');
    const id = loadUser32().symbols.MessageBoxW(
      0n,
      ptr(textBuffer),
      ptr(captionBuffer),
      messageBoxUType(spec),
    );
    return messageBoxResponse(spec.buttons.length, id);
  },

  showOpenDialog(spec: OpenDialogSpec): string[] {
    if (spec.canChooseDirectories && !spec.canChooseFiles) {
      return runFolderDialog();
    }
    const flags =
      OFN_EXPLORER |
      OFN_FILEMUSTEXIST |
      OFN_PATHMUSTEXIST |
      OFN_HIDEREADONLY |
      OFN_NOCHANGEDIR |
      (spec.allowsMultipleSelection ? OFN_ALLOWMULTISELECT : 0);
    return runFileDialog(
      (ofnPtr) => loadComdlg32().symbols.GetOpenFileNameW(ofnPtr),
      spec.extensions,
      flags,
      '',
    );
  },

  showSaveDialog(spec: SaveDialogSpec): string {
    const flags =
      OFN_EXPLORER | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY | OFN_NOCHANGEDIR;
    const [path] = runFileDialog(
      (ofnPtr) => loadComdlg32().symbols.GetSaveFileNameW(ofnPtr),
      spec.extensions,
      flags,
      spec.defaultName,
    );
    return path ?? '';
  },
};
