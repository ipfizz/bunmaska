import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendInitWithContentRect } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import {
  STANDARD_WINDOW_STYLE,
  computeWindowStyleMask,
} from '../../../src/main/platform/macos/cocoa-style-mask';

const NS_BACKING_STORE_BUFFERED = 2n;

if (currentPlatform() === 'macos') {
  describe('NSWindow initWithContentRect:styleMask:backing:defer:', () => {
    test('returns a non-zero initialized window via the struct-as-doubles variant', () => {
      const rt = cocoa();
      const nsWindow = rt.classes.get('NSWindow');
      const allocSel = rt.selectors.get('alloc');
      const initSel = rt.selectors.get('initWithContentRect:styleMask:backing:defer:');
      const releaseSel = rt.selectors.get('release');

      const allocated = rt.msgSend(nsWindow, allocSel);
      expect(allocated).not.toBe(0n);

      const styleMask = BigInt(computeWindowStyleMask(STANDARD_WINDOW_STYLE));

      const window = msgSendInitWithContentRect(
        allocated,
        initSel,
        [100, 100, 400, 300],
        styleMask,
        NS_BACKING_STORE_BUFFERED,
        false,
      );

      expect(window).not.toBe(0n);

      rt.msgSend(window, releaseSel);
    });
  });
}
