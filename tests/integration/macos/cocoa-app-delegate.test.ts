import { dlopen, FFIType } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  type AppDelegateHandlers,
  createAppDelegate,
} from '../../../src/main/platform/macos/cocoa-app-delegate';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import { msgSendPtr, msgSendPtrPtr } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

/** Drives the runtime `BunmaskaAppDelegate` by sending its selectors directly. */

/** `objc_msgSend(id, SEL, id, u64) -> BOOL`; the u64 lets a test put junk above the BOOL byte. */
const sendReopen = (delegate: bigint, flag: bigint): number => {
  const lib = dlopen('libobjc.A.dylib', {
    objc_msgSend: {
      args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
      returns: FFIType.u8,
    },
  });
  try {
    const sel = cocoa().selectors.get('applicationShouldHandleReopen:hasVisibleWindows:');
    return lib.symbols.objc_msgSend(delegate, sel, 0n, flag);
  } finally {
    lib.close();
  }
};

const NOOP_HANDLERS: AppDelegateHandlers = {
  activate: () => undefined,
  openUrl: () => undefined,
  openFile: () => undefined,
};

if (currentPlatform() === 'macos') {
  describe('BunmaskaAppDelegate on the real macOS runtime', () => {
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

    test('Dock reopen reports the BOOL flag and returns it, as Electron does', () => {
      const seen: boolean[] = [];
      const delegate = createAppDelegate({ ...NOOP_HANDLERS, activate: (v) => seen.push(v) });
      expect(sendReopen(delegate.handle, 0n)).toBe(0);
      expect(sendReopen(delegate.handle, 0x1_0000_0001n)).toBe(1);
      expect(seen).toEqual([false, true]);
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

    test('application:openURLs: routes a file URL to openFile as a path', () => {
      const rt = cocoa();
      const urls: string[] = [];
      const files: string[] = [];
      const delegate = createAppDelegate({
        ...NOOP_HANDLERS,
        openUrl: (u) => urls.push(u),
        openFile: (p) => files.push(p),
      });
      const nsApp = rt.msgSend(
        rt.classes.get('NSApplication'),
        rt.selectors.get('sharedApplication'),
      );
      const url = msgSendPtr(
        rt.classes.get('NSURL'),
        rt.selectors.get('fileURLWithPath:'),
        nsString('/tmp/bunmaska open.txt'),
      );
      const array = msgSendPtr(
        rt.classes.get('NSArray'),
        rt.selectors.get('arrayWithObject:'),
        url,
      );
      msgSendPtrPtr(delegate.handle, rt.selectors.get('application:openURLs:'), nsApp, array);
      expect(files).toEqual(['/tmp/bunmaska open.txt']);
      expect(urls).toEqual([]);
    });
  });
}
