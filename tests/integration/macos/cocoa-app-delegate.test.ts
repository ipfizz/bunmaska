import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  type AppDelegateHandlers,
  createAppDelegate,
} from '../../../src/main/platform/macos/cocoa-app-delegate';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import { msgSendPtr, msgSendPtrPtr } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

/**
 * Drives the runtime `SambarAppDelegate` against the real Objective-C runtime.
 * The delegate-callback routing uses the same `defineObjcClass` JSCallback
 * mechanism as the (CI-proven) window/navigation delegates; here we prove the
 * class builds, installs as `NSApp`'s delegate, and routes `openURLs:`/`openFile:`
 * to the JS handlers (the events AppKit normally fires for deep links / file
 * associations).
 */

const NOOP_HANDLERS: AppDelegateHandlers = {
  activate: () => undefined,
  openUrl: () => undefined,
  openFile: () => undefined,
};

if (currentPlatform() === 'macos') {
  describe('SambarAppDelegate on the real macOS runtime', () => {
    test('createAppDelegate returns a live instance', () => {
      const delegate = createAppDelegate(NOOP_HANDLERS);
      expect(delegate.handle).not.toBe(0n);
    });

    test('installs on NSApp and reads back via -delegate', () => {
      const rt = cocoa();
      const nsApp = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      const delegate = createAppDelegate(NOOP_HANDLERS);
      msgSendPtr(nsApp, rt.selectors.get('setDelegate:'), delegate.handle);
      expect(rt.msgSend(nsApp, rt.selectors.get('delegate'))).toBe(delegate.handle);
    });

    test('application:openURLs: routes each URL to the openUrl handler', () => {
      const rt = cocoa();
      const seen: string[] = [];
      const delegate = createAppDelegate({ ...NOOP_HANDLERS, openUrl: (u) => seen.push(u) });
      const nsApp = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      const url = msgSendPtr(
        rt.classes.get('NSURL'),
        rt.selectors.get('URLWithString:'),
        nsString('myapp://open/x'),
      );
      const array = msgSendPtr(
        rt.classes.get('NSArray'),
        rt.selectors.get('arrayWithObject:'),
        url,
      );
      msgSendPtrPtr(delegate.handle, rt.selectors.get('application:openURLs:'), nsApp, array);
      expect(seen).toEqual(['myapp://open/x']);
    });

    test('application:openFile: routes the path to the openFile handler', () => {
      const rt = cocoa();
      let seen: string | undefined;
      const delegate = createAppDelegate({
        ...NOOP_HANDLERS,
        openFile: (p) => {
          seen = p;
        },
      });
      const nsApp = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      msgSendPtrPtr(
        delegate.handle,
        rt.selectors.get('application:openFile:'),
        nsApp,
        nsString('/tmp/sambar-open.txt'),
      );
      expect(seen).toBe('/tmp/sambar-open.txt');
    });
  });
}
