import { type Pointer, ptr, read } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import {
  ALERT_CHOOSE_CB_DEF,
  buildButtonsArray,
  mapChooseResult,
  settleChoose,
  settleFilePath,
} from '../../../../../src/main/platform/linux/gtk-dialog';

describe('ALERT_CHOOSE_CB_DEF (GAsyncReadyCallback ABI, shape-only)', () => {
  it('is (source, result, user_data) -> void', () => {
    expect(ALERT_CHOOSE_CB_DEF.args).toEqual(['ptr', 'ptr', 'ptr']);
    expect(ALERT_CHOOSE_CB_DEF.returns).toBe('void');
  });
});

describe('buildButtonsArray', () => {
  it('produces a NULL-terminated array of one pointer per label plus a trailing 0n', () => {
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

  it('encodes each label as a readable NUL-terminated UTF-8 cstr', () => {
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

  it('yields just a NULL terminator for an empty label list', () => {
    const built = buildButtonsArray([]);
    expect(built.array.length).toBe(1);
    expect(built.array[0]).toBe(0n);
    expect(built.buffers.length).toBe(0);
  });

  it('exposes a non-null pointer to the underlying array for passing to GTK', () => {
    const built = buildButtonsArray(['A']);
    expect(ptr(built.array.buffer)).not.toBe(0);
  });
});

describe('mapChooseResult', () => {
  it('returns the clicked button index when finish yields a valid index', () => {
    expect(mapChooseResult(0, 0, 1)).toBe(0);
    expect(mapChooseResult(2, 0, 1)).toBe(2);
  });

  it('maps the dismissal sentinel (-1) to the cancelId', () => {
    expect(mapChooseResult(-1, 0, 3)).toBe(3);
  });

  it('falls back to the cancelId on any negative (error) index', () => {
    expect(mapChooseResult(-5, 1, 7)).toBe(7);
  });
});

describe('settleChoose (injected finish-fn, no real dialog)', () => {
  it('resolves with the mapped button index from the injected finish-fn', () => {
    const fakeResult = 123 as unknown as Pointer;
    const value = settleChoose({
      result: fakeResult,
      defaultId: 0,
      cancelId: 1,
      finish: (r) => {
        expect(r).toBe(fakeResult);
        return 2;
      },
    });
    expect(value).toBe(2);
  });

  it('maps a -1 dismissal from the injected finish-fn to the cancelId', () => {
    const value = settleChoose({
      result: 0 as unknown as Pointer,
      defaultId: 0,
      cancelId: 5,
      finish: () => -1,
    });
    expect(value).toBe(5);
  });

  it('maps a thrown finish (GError path) to the cancelId', () => {
    const value = settleChoose({
      result: 0 as unknown as Pointer,
      defaultId: 0,
      cancelId: 9,
      finish: () => {
        throw new Error('GTK_DIALOG_ERROR_DISMISSED');
      },
    });
    expect(value).toBe(9);
  });
});

describe('settleFilePath (injected finish + reader, no real dialog)', () => {
  it('returns the read path when the injected finish-fn yields a non-null GFile*', () => {
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

  it('returns empty string when the injected finish-fn yields null (cancel)', () => {
    const path = settleFilePath({
      result: 0 as unknown as Pointer,
      finish: () => null,
      readPath: () => {
        throw new Error('readPath must not be called on cancel');
      },
    });
    expect(path).toBe('');
  });

  it('returns empty string when finish throws (GError / dismissal)', () => {
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
