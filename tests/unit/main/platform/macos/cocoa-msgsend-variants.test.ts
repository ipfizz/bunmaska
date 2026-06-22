import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  msgSendF64,
  msgSendI64,
  msgSendI64Ptr,
  msgSendInitWithContentRect,
  msgSendPtr,
  msgSendPtr4,
  msgSendPtrI64,
  msgSendPtrI64Ptr,
  msgSendPtrI64U8Ptr,
  msgSendPtrPtrI64Ptr,
  msgSendReturnsU8,
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

describe('msgSendI64Ptr export', () => {
  test('is a function', () => {
    expect(typeof msgSendI64Ptr).toBe('function');
  });
});

describe('msgSendReturnsU8 export', () => {
  test('is a function', () => {
    expect(typeof msgSendReturnsU8).toBe('function');
  });
});

describe('msgSendPtr4 export', () => {
  test('is a function', () => {
    expect(typeof msgSendPtr4).toBe('function');
  });
});

describe('msgSendPtrI64U8Ptr export', () => {
  test('is a function', () => {
    expect(typeof msgSendPtrI64U8Ptr).toBe('function');
  });
});

describe('msgSendPtrI64 export', () => {
  test('is a function', () => {
    expect(typeof msgSendPtrI64).toBe('function');
  });
});

describe('msgSendPtrI64Ptr export', () => {
  test('is a function', () => {
    expect(typeof msgSendPtrI64Ptr).toBe('function');
  });
});

describe('msgSendPtrPtrI64Ptr export', () => {
  test('is a function', () => {
    expect(typeof msgSendPtrPtrI64Ptr).toBe('function');
  });
});

if (currentPlatform() !== 'macos') {
  describe('msgSendInitWithContentRect on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendInitWithContentRect(0n, 0n, [0, 0, 0, 0], 0n, 0n, false)).toThrow(
        BunmaskaError,
      );
    });
  });

  describe('msgSendPtr on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendPtr(0n, 0n, 0n)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendU8 on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendU8(0n, 0n, 0)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendF64 on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendF64(0n, 0n, 0)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendI64 on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendI64(0n, 0n, 0n)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendI64Ptr on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendI64Ptr(0n, 0n, 0n, 0n)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendReturnsU8 on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendReturnsU8(0n, 0n)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendPtr4 on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendPtr4(0n, 0n, 0n, 0n, 0n, 0n)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendPtrI64U8Ptr on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendPtrI64U8Ptr(0n, 0n, 0n, 0n, 0, 0n)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendPtrI64 on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendPtrI64(0n, 0n, 0n, 0n)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendPtrI64Ptr on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendPtrI64Ptr(0n, 0n, 0n, 0n, 0n)).toThrow(BunmaskaError);
    });
  });

  describe('msgSendPtrPtrI64Ptr on non-macOS hosts', () => {
    test('throws BunmaskaError', () => {
      expect(() => msgSendPtrPtrI64Ptr(0n, 0n, 0n, 0n, 0n, 0n)).toThrow(BunmaskaError);
    });
  });
}
