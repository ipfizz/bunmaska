import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  cgRectArgs,
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

/**
 * Every variant must refuse to run off macOS rather than dlopen-ing something that
 * is not there. The calls are deliberately made with null handles: off macOS the
 * platform guard fires first, so the arguments never reach objc_msgSend.
 */
const VARIANTS: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'msgSendInitWithContentRect',
    () => msgSendInitWithContentRect(0n, 0n, [0, 0, 0, 0], 0n, 0n, false),
  ],
  ['msgSendPtr', () => msgSendPtr(0n, 0n, 0n)],
  ['msgSendU8', () => msgSendU8(0n, 0n, 0)],
  ['msgSendF64', () => msgSendF64(0n, 0n, 0)],
  ['msgSendI64', () => msgSendI64(0n, 0n, 0n)],
  ['msgSendI64Ptr', () => msgSendI64Ptr(0n, 0n, 0n, 0n)],
  ['msgSendReturnsU8', () => msgSendReturnsU8(0n, 0n)],
  ['msgSendPtr4', () => msgSendPtr4(0n, 0n, 0n, 0n, 0n, 0n)],
  ['msgSendPtrI64U8Ptr', () => msgSendPtrI64U8Ptr(0n, 0n, 0n, 0n, 0, 0n)],
  ['msgSendPtrI64', () => msgSendPtrI64(0n, 0n, 0n, 0n)],
  ['msgSendPtrI64Ptr', () => msgSendPtrI64Ptr(0n, 0n, 0n, 0n, 0n)],
  ['msgSendPtrPtrI64Ptr', () => msgSendPtrPtrI64Ptr(0n, 0n, 0n, 0n, 0n, 0n)],
];

test.skipIf(currentPlatform() === 'macos')(
  'every msgSend variant throws BunmaskaError off macOS',
  () => {
    const unguarded = VARIANTS.filter(([, call]) => {
      try {
        call();
        return true;
      } catch (error) {
        return !(error instanceof BunmaskaError);
      }
    }).map(([name]) => name);

    expect(unguarded).toEqual([]);
  },
);

describe('cgRectArgs (D018)', () => {
  test('arm64 passes a CGRect as four doubles in d0-d3', () => {
    expect(cgRectArgs([1, 2, 3, 4], 'arm64')).toEqual([1, 2, 3, 4]);
  });

  test('x86_64 fills xmm0-7 first so the CGRect spills to the stack like a MEMORY struct', () => {
    expect(cgRectArgs([1, 2, 3, 4], 'x64')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
  });
});
