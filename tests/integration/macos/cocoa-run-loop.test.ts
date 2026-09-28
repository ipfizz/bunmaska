import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  createMacOSDrain,
  withAutoreleasePool,
} from '../../../src/main/platform/macos/cocoa-run-loop';
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
        drain(0);
      }
      expect(typeof drain).toBe('function');
    });

    test('each tick of any drain releases what JS autoreleased since the last tick', () => {
      const rt = cocoa();
      const retainCount = (handle: bigint): bigint =>
        rt.msgSend(handle, rt.selectors.get('retainCount'));
      const first = createMacOSDrain();
      const second = createMacOSDrain();
      const object = rt.msgSend(
        rt.msgSend(rt.classes.get('NSObject'), rt.selectors.get('alloc')),
        rt.selectors.get('init'),
      );
      try {
        for (const drain of [first, second, first, second]) {
          rt.msgSend(
            rt.msgSend(object, rt.selectors.get('retain')),
            rt.selectors.get('autorelease'),
          );
          expect(retainCount(object)).toBe(2n);
          drain(0);
          expect(retainCount(object)).toBe(1n);
        }
      } finally {
        rt.msgSend(object, rt.selectors.get('release'));
      }
    });

    test('withAutoreleasePool releases what its callback autoreleased and returns its value', () => {
      const rt = cocoa();
      const object = rt.msgSend(
        rt.msgSend(rt.classes.get('NSObject'), rt.selectors.get('alloc')),
        rt.selectors.get('init'),
      );
      try {
        const count = withAutoreleasePool(() => {
          rt.msgSend(
            rt.msgSend(object, rt.selectors.get('retain')),
            rt.selectors.get('autorelease'),
          );
          return rt.msgSend(object, rt.selectors.get('retainCount'));
        });
        expect(count).toBe(2n);
        expect(rt.msgSend(object, rt.selectors.get('retainCount'))).toBe(1n);
      } finally {
        rt.msgSend(object, rt.selectors.get('release'));
      }
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
        drain(0);
      }

      expect(msgSendReturnsU8(window, rt.selectors.get('isVisible'))).toBe(1);
    });
  });
}
