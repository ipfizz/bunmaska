import { FFIType } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  cancelOneShotBlock,
  makeOneShotBlock,
  retainedBlockCount,
} from '../../../src/main/platform/macos/cocoa-block';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import { msgSendPtr } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(currentPlatform() !== 'macos')('cancelOneShotBlock', () => {
  test('a cancelled block stays alive and silent until the runtime invokes it', async () => {
    const rt = cocoa();
    const array = msgSendPtr(
      rt.classes.get('NSArray'),
      rt.selectors.get('arrayWithObject:'),
      nsString('late'),
    );
    await delay(20);
    const baseline = retainedBlockCount();
    let fired = 0;
    // ^(id obj, NSUInteger idx, BOOL *stop)
    const block = makeOneShotBlock(() => {
      fired += 1;
    }, [FFIType.u64, FFIType.u64, FFIType.ptr]);

    cancelOneShotBlock(block);
    await delay(20);
    expect(retainedBlockCount()).toBe(baseline + 1);

    msgSendPtr(array, rt.selectors.get('enumerateObjectsUsingBlock:'), block);
    expect(fired).toBe(0);
    await delay(20);
    expect(retainedBlockCount()).toBe(baseline);
  });

  test('cancelling an unknown pointer is a no-op', () => {
    expect(() => cancelOneShotBlock(0x1234n)).not.toThrow();
  });
});
