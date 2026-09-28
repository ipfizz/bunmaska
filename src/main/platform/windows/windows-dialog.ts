import { type Pointer, ptr, read } from 'bun:ffi';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DialogBackend } from '../../api/dialog';
import type { MessageBoxSpec, OpenDialogSpec, SaveDialogSpec } from '../macos/cocoa-dialog';
import { wstr } from './win32';
import { loadComdlg32 } from './win32-dialog-ffi';
import { loadOle32, loadUser32 } from './win32-ffi';
import { loadShell32 } from './win32-shell-ffi';

// Every dialog here runs its own modal loop until dismissed, so (like macOS runModal) the
// native calls cannot run on CI; only the pure mapping below is tested.

// MessageBoxW button sets + icons.
const MB_OK = 0x0;
const MB_OKCANCEL = 0x1;
const MB_YESNOCANCEL = 0x3;
const MB_YESNO = 0x4;
const MB_ICONERROR = 0x10;
const MB_ICONQUESTION = 0x20;
const MB_ICONWARNING = 0x30;
const MB_ICONINFORMATION = 0x40;
// MessageBoxW return ids; IDOK and IDYES both mean the first non-cancel button.
const IDCANCEL = 2;
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
const OFN_INITIAL_DIR_OFFSET = 80; // lpstrInitialDir
const OFN_FLAGS_OFFSET = 96; // Flags
/** `sizeof(BROWSEINFOW)` (x64) and the field offsets used below. */
const BI_SIZE = 64;
const BI_DISPLAY_NAME_OFFSET = 16; // pszDisplayName
const BI_TITLE_OFFSET = 24; // lpszTitle
const BI_FLAGS_OFFSET = 32; // ulFlags

/** In WCHARs: room for a multi-select result list. */
const FILE_BUFFER_WCHARS = 32768;
const MAX_PATH_WCHARS = 260;

/** Electron's default `cancelId` label match: the first "cancel" or "no" button, else -1. */
const cancelLabelIndex = (buttons: ReadonlyArray<string>): number =>
  buttons.findIndex((label) => ['cancel', 'no'].includes(label.toLowerCase()));

/**
 * Map a message-box spec to a `MessageBoxW` `uType`. The native labels are fixed, so the
 * set is chosen to keep Esc on the app's cancel button: 2 buttons with a cancel label get
 * OK/Cancel, 2 without one get Yes/No (no Esc path), 3+ get Yes/No/Cancel. Pure.
 */
export const messageBoxUType = (spec: MessageBoxSpec): number => {
  const count = spec.buttons.length;
  const twoButtons = cancelLabelIndex(spec.buttons) === -1 ? MB_YESNO : MB_OKCANCEL;
  const buttons = count === 2 ? twoButtons : count >= 3 ? MB_YESNOCANCEL : MB_OK;
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

/**
 * Map a `MessageBoxW` return id to a button index: Cancel (and Esc) is Electron's default
 * `cancelId` (the cancel label, else 0), Yes/OK and No are the remaining buttons in order.
 * ponytail: labels stay OK/Yes/No/Cancel and a 4th+ button is unreachable; a WH_CBT hook
 * renaming the buttons (or TaskDialogIndirect) lifts both. Pure.
 */
export const messageBoxResponse = (buttons: ReadonlyArray<string>, id: number): number => {
  const cancel = cancelLabelIndex(buttons);
  if (buttons.length === 2 && cancel === -1) {
    return id === IDNO ? 1 : 0;
  }
  const cancelId = Math.max(cancel, 0);
  if (id === IDCANCEL) {
    return cancelId;
  }
  const others = buttons.map((_, index) => index).filter((index) => index !== cancelId);
  return (id === IDNO ? others[1] : others[0]) ?? 0;
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

/** The folder an open dialog starts in: `defaultPath` itself, or its parent for a file. */
export const initialDirectory = (defaultPath: string): string =>
  defaultPath.length === 0 || statSync(defaultPath, { throwIfNoEntry: false })?.isDirectory()
    ? defaultPath
    : dirname(defaultPath);

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

/**
 * Decode the `lpstrFile` buffer after a confirmed file dialog. A single-select result
 * stops at the first NUL: the dialog does not clear the pre-filled default name's tail.
 */
export const readFileDialogResult = (
  bufferPtr: Pointer,
  maxWchars: number,
  multi: boolean,
): string[] => {
  if (!multi) {
    const path = readPathString(bufferPtr, maxWchars);
    return path.length > 0 ? [path] : [];
  }
  return parseSelectedPaths(readResultString(bufferPtr, maxWchars));
};

/** Run a `GetOpenFileNameW`/`GetSaveFileNameW`-shaped call and return the chosen path(s). */
const runFileDialog = (
  call: (ofnPtr: ReturnType<typeof ptr>) => number,
  extensions: ReadonlyArray<string>,
  flags: number,
  defaultName: string,
  initialDir: string,
): string[] => {
  const filterBuffer = wstr(buildFileFilter(extensions));
  const initialDirBuffer = wstr(initialDir);
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
  if (initialDir.length > 0) {
    view.setBigUint64(OFN_INITIAL_DIR_OFFSET, BigInt(ptr(initialDirBuffer)), true);
  }
  if (call(ptr(ofn)) === 0) {
    return []; // the user cancelled
  }
  return readFileDialogResult(
    fileBufferPtr,
    FILE_BUFFER_WCHARS,
    (flags & OFN_ALLOWMULTISELECT) !== 0,
  );
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
    return messageBoxResponse(spec.buttons, id);
  },

  showOpenDialog(spec: OpenDialogSpec): string[] {
    // Electron: an open dialog cannot pick both on Windows, so openDirectory wins.
    if (spec.canChooseDirectories) {
      return runFolderDialog(); // ponytail: ignores defaultPath (needs a BFFM_SETSELECTION callback)
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
      initialDirectory(spec.defaultPath),
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
      '',
    );
    return path ?? '';
  },
};
