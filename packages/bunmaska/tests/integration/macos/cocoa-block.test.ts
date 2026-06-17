import { describe, expect, test } from 'bun:test';
import { FFIType } from 'bun:ffi';
import { currentPlatform } from '../../../src/common/platform';
import {
  type BlockArg,
  makeOneShotBlock,
  retainedBlockCount,
} from '../../../src/main/platform/macos/cocoa-block';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import { msgSendPtr } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

/**
 * Proves D022 is solved: a hand-built global ObjC Block (built by
 * {@link makeOneShotBlock}) is invoked by the ObjC runtime without crashing.
 * Uses `-[NSArray enumerateObjectsUsingBlock:]` — a synchronous, one-shot block
 * caller (a single-element array invokes the block exactly once). The async
 * run-loop-delivery path uses the identical block and is exercised by the
 * completion-handler features built on top of this primitive.
 */
if (currentPlatform() === 'macos') {
  describe('cocoa-block (hand-built ObjC Blocks)', () => {
    const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    test('the runtime invokes a hand-built block with the right argument', () => {
      const rt = cocoa();
      const str = nsString('bunmaska-block');
      const arr = msgSendPtr(rt.classes.get('NSArray'), rt.selectors.get('arrayWithObject:'), str);

      let fired = 0;
      let received: BlockArg | undefined;
      // ^(id obj, NSUInteger idx, BOOL *stop)
      const block = makeOneShotBlock(
        (obj) => {
          fired += 1;
          received = obj ?? null;
        },
        [FFIType.ptr, FFIType.u64, FFIType.ptr],
      );

      msgSendPtr(arr, rt.selectors.get('enumerateObjectsUsingBlock:'), block);

      expect(fired).toBe(1);
      // The block received the array's single NSString element (a non-null id).
      expect(received).not.toBeUndefined();
      expect(received).not.toBe(0);
      expect(received).not.toBeNull();
    });

    test('a one-shot block frees its retained resources after it fires', async () => {
      const rt = cocoa();
      const str = nsString('cleanup');
      const arr = msgSendPtr(rt.classes.get('NSArray'), rt.selectors.get('arrayWithObject:'), str);
      await flush(); // drain any deferred closes still pending from earlier tests
      const before = retainedBlockCount();

      const block = makeOneShotBlock(() => undefined, [FFIType.ptr, FFIType.u64, FFIType.ptr]);
      expect(retainedBlockCount()).toBe(before + 1);

      msgSendPtr(arr, rt.selectors.get('enumerateObjectsUsingBlock:'), block);
      await flush();
      // The deferred close ran, dropping the retained literal + JSCallback.
      expect(retainedBlockCount()).toBe(before);
    });
  });
}
