import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  cancelOneShotBlock,
  makeOneShotBlock,
  retainedBlockCount,
} from '../../../src/main/platform/macos/cocoa-block';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('cancelOneShotBlock', () => {
  test.skipIf(currentPlatform() !== 'macos')(
    'a cancelled never-fired block returns retention to baseline',
    async () => {
      // Every timed-out printToPDF/capturePage leaked its block before this.
      const baseline = retainedBlockCount();
      const block = makeOneShotBlock(() => undefined, []);
      expect(retainedBlockCount()).toBe(baseline + 1);
      cancelOneShotBlock(block);
      await delay(20); // the close is deferred one tick by design
      expect(retainedBlockCount()).toBe(baseline);
    },
  );

  test.skipIf(currentPlatform() !== 'macos')('cancelling an unknown pointer is a no-op', () => {
    expect(() => cancelOneShotBlock(0x1234n)).not.toThrow();
  });
});
