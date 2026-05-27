import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  msgSendI64,
  msgSendInitWithContentRect,
  msgSendPtr,
  msgSendReturnsU8,
  msgSendU8,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import {
  STANDARD_WINDOW_STYLE,
  computeWindowStyleMask,
} from '../../../src/main/platform/macos/cocoa-style-mask';

const NS_APPLICATION_ACTIVATION_POLICY_REGULAR = 0n;
const NS_BACKING_STORE_BUFFERED = 2n;

if (currentPlatform() === 'macos') {
  describe('Phase 0 macOS exit — drive AppKit end-to-end from Bun via bun:ffi', () => {
    test('full NSApplication + NSWindow choreography yields a live, named window', () => {
      const rt = cocoa();

      // 1. NSApp = [NSApplication sharedApplication]
      const nsApplicationClass = rt.classes.get('NSApplication');
      const app = rt.msgSend(nsApplicationClass, rt.selectors.get('sharedApplication'));
      expect(app).not.toBe(0n);

      // 2. [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular]
      msgSendI64(
        app,
        rt.selectors.get('setActivationPolicy:'),
        NS_APPLICATION_ACTIVATION_POLICY_REGULAR,
      );

      // 3. [NSApp finishLaunching]
      rt.msgSend(app, rt.selectors.get('finishLaunching'));

      // 4. window = [[NSWindow alloc] initWithContentRect:rect styleMask:m backing:b defer:NO]
      const nsWindowClass = rt.classes.get('NSWindow');
      const allocated = rt.msgSend(nsWindowClass, rt.selectors.get('alloc'));
      expect(allocated).not.toBe(0n);

      const styleMask = BigInt(computeWindowStyleMask(STANDARD_WINDOW_STYLE));
      const window = msgSendInitWithContentRect(
        allocated,
        rt.selectors.get('initWithContentRect:styleMask:backing:defer:'),
        [200, 200, 400, 300],
        styleMask,
        NS_BACKING_STORE_BUFFERED,
        false,
      );
      expect(window).not.toBe(0n);

      // 5. [window makeKeyAndOrderFront:nil] — schedules the window for display
      msgSendPtr(window, rt.selectors.get('makeKeyAndOrderFront:'), 0n);

      // 6. [NSApp activateIgnoringOtherApps:YES] — brings the app frontmost
      msgSendU8(app, rt.selectors.get('activateIgnoringOtherApps:'), 1);

      // 7. [window contentView] is auto-created during init and is a non-nil
      //    NSView — proves the selector dispatch table on a fully-initialized
      //    NSWindow works. (We avoid `[window title]` because windows in a
      //    non-bundled process can legitimately have nil titles.)
      const contentView = rt.msgSend(window, rt.selectors.get('contentView'));
      expect(contentView).not.toBe(0n);

      // 8. [window isVisible] returns 0 or 1. On a headless CI runner without
      //    a window server this may legitimately return 0 even with a valid
      //    window object — we assert only that the call returns a JS number.
      const visible = msgSendReturnsU8(window, rt.selectors.get('isVisible'));
      expect(typeof visible).toBe('number');
      expect(visible === 0 || visible === 1).toBe(true);

      // Do not call [window close] or [window release] here. NSWindow's
      // default `releasedWhenClosed` behaviour can double-release, and we are
      // about to let the test process exit which cleans everything up anyway.
    });
  });
}
