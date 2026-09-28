import { type Pointer, ptr, read } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import {
  buildButtonsArray,
  cancelIdForButtons,
  extensionPattern,
  mapChooseResult,
  settleChoose,
  settleFilePath,
} from '../../../../../src/main/platform/linux/gtk-dialog';

describe('buildButtonsArray', () => {
  test('produces a NULL-terminated array of one pointer per label plus a trailing 0n', () => {
    const built = buildButtonsArray(['Yes', 'No', 'Cancel']);
    // 3 labels + 1 NULL terminator.
    expect(built.array.length).toBe(4);
    expect(built.array[3]).toBe(0n);
    // The first three entries are non-null cstr pointers.
    expect(built.array[0]).not.toBe(0n);
    expect(built.array[1]).not.toBe(0n);
    expect(built.array[2]).not.toBe(0n);
    // Retains one cstr buffer per label so they outlive the native call.
    expect(built.buffers.length).toBe(3);
  });

  test('encodes each label as a readable NUL-terminated UTF-8 cstr', () => {
    const built = buildButtonsArray(['OK']);
    // Read the bytes back through the pointer to prove it points at "OK\0".
    const base = Number(built.array[0]) as unknown as Pointer;
    const b0 = read.u8(base, 0);
    const b1 = read.u8(base, 1);
    const b2 = read.u8(base, 2);
    expect(b0).toBe('O'.charCodeAt(0));
    expect(b1).toBe('K'.charCodeAt(0));
    expect(b2).toBe(0);
  });

  test('yields just a NULL terminator for an empty label list', () => {
    const built = buildButtonsArray([]);
    expect(built.array.length).toBe(1);
    expect(built.array[0]).toBe(0n);
    expect(built.buffers.length).toBe(0);
  });

  test('exposes a non-null pointer to the underlying array for passing to GTK', () => {
    const built = buildButtonsArray(['A']);
    expect(ptr(built.array.buffer)).not.toBe(0);
  });
});

describe('mapChooseResult', () => {
  test('returns the clicked button index when finish yields a valid index', () => {
    expect(mapChooseResult(0, 1)).toBe(0);
    expect(mapChooseResult(2, 1)).toBe(2);
  });

  test('maps the dismissal sentinel (-1) to the cancelId', () => {
    expect(mapChooseResult(-1, 3)).toBe(3);
  });

  test('falls back to the cancelId on any negative (error) index', () => {
    expect(mapChooseResult(-5, 7)).toBe(7);
  });
});

describe('cancelIdForButtons', () => {
  test('picks the first button labelled cancel or no, case-insensitively (Electron default)', () => {
    expect(cancelIdForButtons(['Yes', 'No'])).toBe(1);
    expect(cancelIdForButtons(['Save', 'CANCEL', 'No'])).toBe(1);
  });

  test('falls back to 0 when no button is a cancel label', () => {
    expect(cancelIdForButtons(['OK', 'Retry'])).toBe(0);
  });
});

describe('extensionPattern', () => {
  test('matches an extension in any letter case (GTK globs are case-sensitive on Linux)', () => {
    expect(extensionPattern('jpg')).toBe('*.[jJ][pP][gG]');
    expect(extensionPattern('Tar.gz')).toBe('*.[tT][aA][rR].[gG][zZ]');
    expect(extensionPattern('mp4')).toBe('*.[mM][pP]4');
  });
});

describe('settleChoose (injected finish-fn, no real dialog)', () => {
  test('resolves with the mapped button index from the injected finish-fn', () => {
    const fakeResult = 123 as unknown as Pointer;
    const value = settleChoose({
      result: fakeResult,
      cancelId: 1,
      finish: (r) => {
        expect(r).toBe(fakeResult);
        return 2;
      },
    });
    expect(value).toBe(2);
  });

  test('maps a -1 dismissal from the injected finish-fn to the cancelId', () => {
    const value = settleChoose({
      result: 0 as unknown as Pointer,
      cancelId: 5,
      finish: () => -1,
    });
    expect(value).toBe(5);
  });

  test('maps a thrown finish (GError path) to the cancelId', () => {
    const value = settleChoose({
      result: 0 as unknown as Pointer,
      cancelId: 9,
      finish: () => {
        throw new Error('GTK_DIALOG_ERROR_DISMISSED');
      },
    });
    expect(value).toBe(9);
  });
});

describe('settleFilePath (injected finish + reader, no real dialog)', () => {
  test('returns the read path when the injected finish-fn yields a non-null GFile*', () => {
    const fakeFile = 42 as unknown as Pointer;
    const path = settleFilePath({
      result: 0 as unknown as Pointer,
      finish: () => fakeFile,
      readPath: (file) => {
        expect(file).toBe(fakeFile);
        return '/home/user/notes.md';
      },
    });
    expect(path).toBe('/home/user/notes.md');
  });

  test('returns empty string when the injected finish-fn yields null (cancel)', () => {
    const path = settleFilePath({
      result: 0 as unknown as Pointer,
      finish: () => null,
      readPath: () => {
        throw new Error('readPath must not be called on cancel');
      },
    });
    expect(path).toBe('');
  });

  test('returns empty string when finish throws (GError / dismissal)', () => {
    const path = settleFilePath({
      result: 0 as unknown as Pointer,
      finish: () => {
        throw new Error('dismissed');
      },
      readPath: () => '/should/not/return',
    });
    expect(path).toBe('');
  });
});
