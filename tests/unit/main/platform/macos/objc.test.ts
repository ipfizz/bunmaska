import { describe, expect, test } from 'bun:test';
import { FFIError, UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  bigIntOut,
  type Handle,
  macOSLibraryAccessor,
  ptrIn,
} from '../../../../../src/main/platform/macos/objc';

describe('ptrIn', () => {
  test('converts a bigint handle to a numeric pointer', () => {
    expect(Number(ptrIn(4636917472n))).toBe(4636917472);
  });

  test('converts 0n to 0', () => {
    expect(Number(ptrIn(0n))).toBe(0);
  });

  test('refuses a handle a JS number cannot hold exactly, such as a tagged pointer', () => {
    expect(() => ptrIn(0x8000_0000_0000_0011n)).toThrow(FFIError);
    expect(() => ptrIn(2n ** 53n + 1n)).toThrow(FFIError);
  });
});

describe('bigIntOut', () => {
  test('converts a numeric pointer to a bigint handle', () => {
    expect(bigIntOut(4636917472 as never)).toBe(4636917472n);
  });

  test('converts null to 0n', () => {
    expect(bigIntOut(null)).toBe(0n);
  });

  test('round-trips with ptrIn', () => {
    const h: Handle = 123456789n;
    expect(bigIntOut(ptrIn(h) as never)).toBe(h);
  });
});

describe('macOSLibraryAccessor', () => {
  test.skipIf(currentPlatform() !== 'macos')(
    'returns a memoising accessor that calls open at most once',
    () => {
      let opens = 0;
      const get = macOSLibraryAccessor('test', () => {
        opens += 1;
        return { value: opens };
      });
      const a = get();
      const b = get();
      expect(a).toBe(b);
      expect(opens).toBe(1);
    },
  );

  test.skipIf(currentPlatform() === 'macos')(
    'throws UnsupportedPlatformError on non-macOS hosts',
    () => {
      const get = macOSLibraryAccessor('test', () => ({}));
      expect(() => get()).toThrow(UnsupportedPlatformError);
    },
  );
});
