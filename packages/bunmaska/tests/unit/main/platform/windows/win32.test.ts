import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  NULL_HANDLE,
  type WinHandle,
  winLibraryAccessor,
  wstr,
} from '../../../../../src/main/platform/windows/win32';

describe('wstr', () => {
  test('returns a Uint8Array', () => {
    expect(wstr('x')).toBeInstanceOf(Uint8Array);
  });

  test('null-terminates with a UTF-16 (two-byte) NUL', () => {
    const bytes = wstr('hello');
    expect(bytes[bytes.length - 2]).toBe(0);
    expect(bytes[bytes.length - 1]).toBe(0);
  });

  test('encodes ASCII as little-endian UTF-16', () => {
    // 'Hi' -> H=0x48, i=0x69, each a little-endian 16-bit unit, then a 16-bit NUL.
    expect(Array.from(wstr('Hi'))).toEqual([0x48, 0x00, 0x69, 0x00, 0x00, 0x00]);
  });

  test('encodes the empty string as a single two-byte NUL', () => {
    expect(Array.from(wstr(''))).toEqual([0x00, 0x00]);
  });

  test('encodes a BMP non-ASCII character (U+00E9 e-acute)', () => {
    expect(Array.from(wstr('é'))).toEqual([0xe9, 0x00, 0x00, 0x00]);
  });

  test('encodes a surrogate pair (U+1F98A) as two little-endian code units', () => {
    // U+1F98A -> surrogates D83E DD8A -> LE bytes 3E D8 8A DD, then a 16-bit NUL.
    expect(Array.from(wstr('\u{1f98a}'))).toEqual([0x3e, 0xd8, 0x8a, 0xdd, 0x00, 0x00]);
  });

  test('byte length is (code units + 1) * 2', () => {
    expect(wstr('abc')).toHaveLength((3 + 1) * 2);
  });
});

describe('NULL_HANDLE', () => {
  test('is the zero bigint handle', () => {
    const handle: WinHandle = NULL_HANDLE;
    expect(handle).toBe(0n);
  });
});

describe('winLibraryAccessor', () => {
  test('returns a memoising accessor that calls open at most once', () => {
    if (currentPlatform() !== 'windows') {
      return;
    }
    let opens = 0;
    const get = winLibraryAccessor('test', () => {
      opens += 1;
      return { value: opens };
    });
    const a = get();
    const b = get();
    expect(a).toBe(b);
    expect(opens).toBe(1);
  });

  test('throws UnsupportedPlatformError on non-Windows hosts', () => {
    if (currentPlatform() === 'windows') {
      return;
    }
    const get = winLibraryAccessor('test', () => ({}));
    expect(() => get()).toThrow(UnsupportedPlatformError);
  });
});
