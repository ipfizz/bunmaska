import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createAppDelegate } from '../../../src/main/platform/macos/cocoa-app-delegate';
import { msgSendPtr } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

/**
 * Drives the runtime `SambarAppDelegate` against the real Objective-C runtime.
 * The Dock-reopen callback routing uses the same `defineObjcClass` JSCallback
 * mechanism as the (CI-proven) window/navigation delegates; here we prove the
 * class builds, instantiates, and installs as `NSApp`'s delegate.
 */

if (currentPlatform() === 'macos') {
  describe('SambarAppDelegate on the real macOS runtime', () => {
    test('createAppDelegate returns a live instance', () => {
      const delegate = createAppDelegate({ activate: () => undefined });
      expect(delegate.handle).not.toBe(0n);
    });

    test('installs on NSApp and reads back via -delegate', () => {
      const rt = cocoa();
      const nsApp = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      const delegate = createAppDelegate({ activate: () => undefined });
      msgSendPtr(nsApp, rt.selectors.get('setDelegate:'), delegate.handle);
      expect(rt.msgSend(nsApp, rt.selectors.get('delegate'))).toBe(delegate.handle);
    });
  });
}
