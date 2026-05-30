import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createMacOSDrain } from '../../../src/main/platform/macos/cocoa-run-loop';
import {
  msgSendI64,
  msgSendInitWithContentRect,
  msgSendPtr,
  msgSendReturnsU8,
  msgSendU8,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import {
  computeWindowStyleMask,
  STANDARD_WINDOW_STYLE,
} from '../../../src/main/platform/macos/cocoa-style-mask';

const NS_BACKING_STORE_BUFFERED = 2n;

if (currentPlatform() === 'macos') {
  describe('createMacOSDrain', () => {
    test('returns a drain function that runs many times without crashing', () => {
      const drain = createMacOSDrain();
      for (let i = 0; i < 50; i += 1) {
        drain();
      }
      expect(typeof drain).toBe('function');
    });

    test('pumping the drain makes a real NSWindow visible', () => {
      const rt = cocoa();
      const app = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      msgSendI64(app, rt.selectors.get('setActivationPolicy:'), 0n);
      rt.msgSend(app, rt.selectors.get('finishLaunching'));

      const allocated = rt.msgSend(rt.classes.get('NSWindow'), rt.selectors.get('alloc'));
      const window = msgSendInitWithContentRect(
        allocated,
        rt.selectors.get('initWithContentRect:styleMask:backing:defer:'),
        [200, 200, 360, 240],
        BigInt(computeWindowStyleMask(STANDARD_WINDOW_STYLE)),
        NS_BACKING_STORE_BUFFERED,
        false,
      );
      msgSendPtr(window, rt.selectors.get('makeKeyAndOrderFront:'), 0n);
      msgSendU8(app, rt.selectors.get('activateIgnoringOtherApps:'), 1);

      const drain = createMacOSDrain();
      for (let i = 0; i < 60; i += 1) {
        drain();
      }

      expect(msgSendReturnsU8(window, rt.selectors.get('isVisible'))).toBe(1);
    });
  });
}
