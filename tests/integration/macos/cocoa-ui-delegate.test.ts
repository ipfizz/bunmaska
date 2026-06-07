import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createUIDelegate } from '../../../src/main/platform/macos/cocoa-ui-delegate';

// Builds the runtime WKUIDelegate class (exercising the 'object'-return IMP path)
// and allocates an instance — no window, so safe to run in the standard suite.
if (currentPlatform() === 'macos') {
  describe('SambarUIDelegate on the real macOS runtime', () => {
    test('createUIDelegate returns a live instance', () => {
      expect(createUIDelegate(() => undefined).handle).not.toBe(0n);
    });
  });
}
