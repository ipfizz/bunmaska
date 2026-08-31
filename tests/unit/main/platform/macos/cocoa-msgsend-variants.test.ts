import { expect, test } from 'bun:test';
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
