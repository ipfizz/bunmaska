import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { MessageBoxSpec } from '../../../../../src/main/platform/macos/cocoa-dialog';
import {
  buildFileFilter,
  messageBoxResponse,
  messageBoxUType,
  parseSelectedPaths,
} from '../../../../../src/main/platform/windows/windows-dialog';

/**
 * Pure option→native mapping for the Windows dialog backend. The dialogs
 * themselves are modal (untestable on CI, like macOS `runModal`); these cover the
 * `MessageBoxW` button-set/icon/response mapping, the `OPENFILENAMEW` filter
 * string, and multi-select result parsing.
 */
const MB_OK = 0x0;
const MB_OKCANCEL = 0x1;
const MB_YESNOCANCEL = 0x3;
const MB_ICONERROR = 0x10;
const MB_ICONWARNING = 0x30;
const MB_ICONINFORMATION = 0x40;
const IDOK = 1;
const IDCANCEL = 2;
const IDYES = 6;
const IDNO = 7;

const spec = (buttons: string[], type?: MessageBoxSpec['type']): MessageBoxSpec => ({
  message: 'm',
  detail: 'd',
  buttons,
  ...(type !== undefined ? { type } : {}),
});

describe('messageBoxUType', () => {
  test('button count picks the closest MessageBoxW set', () => {
    expect(messageBoxUType(spec(['OK']))).toBe(MB_OK);
    expect(messageBoxUType(spec(['Save', 'Cancel']))).toBe(MB_OKCANCEL);
    expect(messageBoxUType(spec(['Yes', 'No', 'Cancel']))).toBe(MB_YESNOCANCEL);
    expect(messageBoxUType(spec(['a', 'b', 'c', 'd']))).toBe(MB_YESNOCANCEL); // >3 → 3-set
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
    expect(messageBoxResponse(1, IDOK)).toBe(0);
  });

  test('two buttons map OK/Yes→0 and Cancel/No→1', () => {
    expect(messageBoxResponse(2, IDOK)).toBe(0);
    expect(messageBoxResponse(2, IDCANCEL)).toBe(1);
  });

  test('three buttons map Yes/No/Cancel to 0/1/2', () => {
    expect(messageBoxResponse(3, IDYES)).toBe(0);
    expect(messageBoxResponse(3, IDNO)).toBe(1);
    expect(messageBoxResponse(3, IDCANCEL)).toBe(2);
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
