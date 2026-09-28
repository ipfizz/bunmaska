import { describe, expect, test } from 'bun:test';
import { ptr } from 'bun:ffi';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessageBoxSpec } from '../../../../../src/main/platform/macos/cocoa-dialog';
import {
  buildFileFilter,
  initialDirectory,
  messageBoxResponse,
  messageBoxUType,
  parseSelectedPaths,
  readFileDialogResult,
} from '../../../../../src/main/platform/windows/windows-dialog';

/**
 * Pure option→native mapping for the Windows dialog backend. The dialogs
 * themselves are modal (untestable on CI, like macOS `runModal`); these cover the
 * `MessageBoxW` button-set/icon/response mapping, the `OPENFILENAMEW` filter
 * string, and multi-select result parsing.
 */
const MB_OK = 0x0;
const MB_OKCANCEL = 0x1;
const MB_YESNO = 0x4;
const MB_YESNOCANCEL = 0x3;
const MB_ICONERROR = 0x10;
const MB_ICONWARNING = 0x30;
const MB_ICONINFORMATION = 0x40;
const IDOK = 1;
const IDCANCEL = 2;
const IDYES = 6;
const IDNO = 7;

/** A UTF-16LE `lpstrFile` buffer holding `text`, zero-padded to `wchars`. */
const fileBuffer = (text: string, wchars: number): Uint8Array => {
  const buffer = new Uint8Array(wchars * 2);
  for (let i = 0; i < text.length; i += 1) {
    buffer[i * 2] = text.charCodeAt(i) & 0xff;
    buffer[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  return buffer;
};

const spec = (buttons: string[], type?: MessageBoxSpec['type']): MessageBoxSpec => ({
  message: 'm',
  detail: 'd',
  buttons,
  ...(type !== undefined ? { type } : {}),
});

describe('messageBoxUType', () => {
  test('button count and a cancel label pick the MessageBoxW set', () => {
    expect(messageBoxUType(spec(['OK']))).toBe(MB_OK);
    expect(messageBoxUType(spec(['Save', 'Cancel']))).toBe(MB_OKCANCEL);
    expect(messageBoxUType(spec(['Save', 'Discard']))).toBe(MB_YESNO);
    expect(messageBoxUType(spec(['Yes', 'No', 'Cancel']))).toBe(MB_YESNOCANCEL);
    expect(messageBoxUType(spec(['a', 'b', 'c', 'd']))).toBe(MB_YESNOCANCEL);
  });

  test('severity adds the icon flag', () => {
    expect(messageBoxUType(spec(['OK'], 'error'))).toBe(MB_OK | MB_ICONERROR);
    expect(messageBoxUType(spec(['OK'], 'warning'))).toBe(MB_OK | MB_ICONWARNING);
    expect(messageBoxUType(spec(['OK'], 'info'))).toBe(MB_OK | MB_ICONINFORMATION);
    expect(messageBoxUType(spec(['OK'], 'none'))).toBe(MB_OK);
  });
});

describe('messageBoxResponse', () => {
  test('single OK is always index 0', () => {
    expect(messageBoxResponse(['OK'], IDOK)).toBe(0);
  });

  test('native Cancel (and Esc) resolves to the cancel label, never the other button', () => {
    expect(messageBoxResponse(['Cancel', 'Delete'], IDCANCEL)).toBe(0);
    expect(messageBoxResponse(['Cancel', 'Delete'], IDOK)).toBe(1);
    expect(messageBoxResponse(['OK', 'Cancel'], IDOK)).toBe(0);
    expect(messageBoxResponse(['OK', 'Cancel'], IDCANCEL)).toBe(1);
  });

  test('two buttons without a cancel label map Yes/No to 0/1', () => {
    expect(messageBoxResponse(['Save', 'Discard'], IDYES)).toBe(0);
    expect(messageBoxResponse(['Save', 'Discard'], IDNO)).toBe(1);
  });

  test('three buttons map Cancel to the cancel label and Yes/No to the rest in order', () => {
    const buttons = ['Cancel', 'Yes, please', 'No, thanks'];
    expect(messageBoxResponse(buttons, IDCANCEL)).toBe(0);
    expect(messageBoxResponse(buttons, IDYES)).toBe(1);
    expect(messageBoxResponse(buttons, IDNO)).toBe(2);
    expect(messageBoxResponse(['Save', "Don't Save", 'Cancel'], IDCANCEL)).toBe(2);
    expect(messageBoxResponse(['Save', "Don't Save", 'Cancel'], IDNO)).toBe(1);
  });

  test('without a cancel label, Cancel resolves to 0 like Electron', () => {
    expect(messageBoxResponse(['a', 'b', 'c'], IDCANCEL)).toBe(0);
    expect(messageBoxResponse(['a', 'b', 'c'], IDYES)).toBe(1);
  });
});

describe('buildFileFilter', () => {
  test('empty extensions → All Files only', () => {
    expect(buildFileFilter([])).toBe('All Files (*.*)\0*.*\0');
  });

  test('extensions → a Files pattern then All Files', () => {
    expect(buildFileFilter(['png', 'jpg'])).toBe(
      'Files (*.png;*.jpg)\0*.png;*.jpg\0All Files (*.*)\0*.*\0',
    );
  });

  test('the segments split cleanly on NUL into display/pattern pairs', () => {
    const parts = buildFileFilter(['txt'])
      .split('\0')
      .filter((p) => p.length > 0);
    expect(parts).toEqual(['Files (*.txt)', '*.txt', 'All Files (*.*)', '*.*']);
  });
});

describe('parseSelectedPaths', () => {
  test('a single segment is one selected file', () => {
    expect(parseSelectedPaths('C:\\docs\\a.txt')).toEqual(['C:\\docs\\a.txt']);
  });

  test('multiple segments are directory + names joined into full paths', () => {
    expect(parseSelectedPaths('C:\\docs\0a.txt\0b.png')).toEqual([
      join('C:\\docs', 'a.txt'),
      join('C:\\docs', 'b.png'),
    ]);
  });

  test('empty input is no selection', () => {
    expect(parseSelectedPaths('')).toEqual([]);
  });
});

describe('readFileDialogResult', () => {
  test('a single-select result stops at the first NUL, ignoring a longer default name', () => {
    // GetSaveFileNameW overwrote 'C:\\docs\\Untitled Document.txt' with a shorter path.
    const buffer = fileBuffer('C:\\docs\\a.txt\0ed Document.txt\0', 64);
    expect(readFileDialogResult(ptr(buffer), 64, false)).toEqual(['C:\\docs\\a.txt']);
  });

  test('a multi-select result reads the directory and names up to the double NUL', () => {
    const buffer = fileBuffer('C:\\docs\0a.txt\0b.png\0', 64);
    expect(readFileDialogResult(ptr(buffer), 64, true)).toEqual([
      join('C:\\docs', 'a.txt'),
      join('C:\\docs', 'b.png'),
    ]);
  });
});

describe('initialDirectory', () => {
  test('a folder opens as itself, a file at its parent, and no path at the system default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bunmaska-dialog-'));
    try {
      const file = join(dir, 'notes.txt');
      writeFileSync(file, '');
      expect(initialDirectory(dir)).toBe(dir);
      expect(initialDirectory(file)).toBe(dir);
      expect(initialDirectory('')).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
