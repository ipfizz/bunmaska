import { describe, expect, test } from 'bun:test';
import { SambarError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  msgSendF64,
  msgSendI64,
  msgSendInitWithContentRect,
  msgSendPtr,
  msgSendU8,
} from '../../../../../src/main/platform/macos/cocoa-msgsend-variants';

describe('msgSendInitWithContentRect export', () => {
  test('is a function', () => {
    expect(typeof msgSendInitWithContentRect).toBe('function');
  });
});

describe('msgSendPtr export', () => {
  test('is a function', () => {
    expect(typeof msgSendPtr).toBe('function');
  });
});

describe('msgSendU8 export', () => {
  test('is a function', () => {
    expect(typeof msgSendU8).toBe('function');
  });
});

describe('msgSendF64 export', () => {
  test('is a function', () => {
    expect(typeof msgSendF64).toBe('function');
  });
});

describe('msgSendI64 export', () => {
  test('is a function', () => {
    expect(typeof msgSendI64).toBe('function');
  });
});

if (currentPlatform() !== 'macos') {
  describe('msgSendInitWithContentRect on non-macOS hosts', () => {
    test('throws SambarError', () => {
      expect(() => msgSendInitWithContentRect(0n, 0n, [0, 0, 0, 0], 0n, 0n, false)).toThrow(
        SambarError,
      );
    });
  });

  describe('msgSendPtr on non-macOS hosts', () => {
    test('throws SambarError', () => {
      expect(() => msgSendPtr(0n, 0n, 0n)).toThrow(SambarError);
    });
  });

  describe('msgSendU8 on non-macOS hosts', () => {
    test('throws SambarError', () => {
      expect(() => msgSendU8(0n, 0n, 0)).toThrow(SambarError);
    });
  });

  describe('msgSendF64 on non-macOS hosts', () => {
    test('throws SambarError', () => {
      expect(() => msgSendF64(0n, 0n, 0)).toThrow(SambarError);
    });
  });

  describe('msgSendI64 on non-macOS hosts', () => {
    test('throws SambarError', () => {
      expect(() => msgSendI64(0n, 0n, 0n)).toThrow(SambarError);
    });
  });
}
