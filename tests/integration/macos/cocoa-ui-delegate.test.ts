import { FFIType } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import { type BlockArg, makeOneShotBlock } from '../../../src/main/platform/macos/cocoa-block';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendI64,
  msgSendInitWithContentRect,
  msgSendPtr,
  msgSendPtr4,
  msgSendPtrI64,
  msgSendReturnsI64,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { defineObjcClass } from '../../../src/main/platform/macos/cocoa-runtime-class';
import { createUIDelegate } from '../../../src/main/platform/macos/cocoa-ui-delegate';
import type { Handle } from '../../../src/main/platform/macos/objc';

let request: Handle = 0n;
let actionClass: Handle | undefined;

/** A stand-in `WKNavigationAction` whose `-request` targets `url`. */
const navigationAction = (url: string): Handle => {
  const rt = cocoa();
  actionClass ??= defineObjcClass('BunmaskaTestNavigationAction', 'NSObject', [
    { selector: 'request', typeEncoding: '@@:', args: [], returns: 'object', impl: () => request },
  ]);
  const nsUrl = msgSendPtr(
    rt.classes.get('NSURL'),
    rt.selectors.get('URLWithString:'),
    nsString(url),
  );
  request = msgSendPtr(rt.classes.get('NSURLRequest'), rt.selectors.get('requestWithURL:'), nsUrl);
  rt.msgSend(request, rt.selectors.get('retain'));
  return rt.msgSend(rt.msgSend(actionClass, rt.selectors.get('alloc')), rt.selectors.get('init'));
};

const ALERT = 'webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:';
const CONFIRM = 'webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:';
const OPEN = 'webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:';

/** Send a panel selector with a completion block; resolves with the block's argument. */
const runPanel = (selector: string, webView: Handle, argTypes: FFIType[]): Promise<BlockArg> =>
  new Promise((resolve) => {
    const delegate = createUIDelegate(() => undefined);
    const done = makeOneShotBlock((arg = null) => resolve(arg), argTypes);
    const sel = cocoa().selectors.get(selector);
    // The second argument is the message NSString, or the WKOpenPanelParameters (nil here).
    const second = selector === OPEN ? 0n : nsString('Sure?');
    msgSendPtr4(delegate.handle, sel, webView, second, 0n, done);
  });

const withDeadline = <T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([promise, Bun.sleep(ms).then(() => 'timeout' as const)]);

if (currentPlatform() === 'macos') {
  describe('BunmaskaUIDelegate', () => {
    test('alert, confirm and file input with no window reply at once as cancelled', async () => {
      expect(await withDeadline(runPanel(ALERT, 0n, []), 2000)).toBe(null);
      expect(await withDeadline(runPanel(CONFIRM, 0n, [FFIType.u8]), 2000)).toBe(0);
      expect(await withDeadline(runPanel(OPEN, 0n, [FFIType.u64]), 2000)).toBe(0n);
    });

    test('confirm shows a sheet on the web view window and replies with the clicked button', async () => {
      const rt = cocoa();
      const app = createMacOSApplication();
      app.start();
      const window = msgSendInitWithContentRect(
        rt.msgSend(rt.classes.get('NSWindow'), rt.selectors.get('alloc')),
        rt.selectors.get('initWithContentRect:styleMask:backing:defer:'),
        [100, 100, 400, 300],
        1n,
        2n,
        false,
      );
      try {
        msgSendPtr(window, rt.selectors.get('makeKeyAndOrderFront:'), 0n);
        const webView = rt.msgSend(window, rt.selectors.get('contentView'));
        const reply = runPanel(CONFIRM, webView, [FFIType.u8]);
        const sheet = rt.msgSend(window, rt.selectors.get('attachedSheet'));
        expect(sheet).not.toBe(0n);
        msgSendPtrI64(window, rt.selectors.get('endSheet:returnCode:'), sheet, 1000n);
        expect(await withDeadline(reply, 5000)).toBe(1);
      } finally {
        rt.msgSend(window, rt.selectors.get('close'));
        app.quit();
      }
    });

    test('a page confirm() gets a sheet from WebKit and sees the answer', async () => {
      const rt = cocoa();
      const app = createMacOSApplication();
      app.start();
      const win = app.createWindow({ width: 400, height: 300, title: 'confirm', show: true });
      try {
        win.webContents.loadHTML(
          '<script>setTimeout(() => { document.title = String(confirm("sure?")); }, 0)</script>',
          'about:blank',
        );
        const nsApp = rt.msgSend(
          rt.classes.get('NSApplication'),
          rt.selectors.get('sharedApplication'),
        );
        let host = 0n;
        let sheet = 0n;
        for (let waited = 0; sheet === 0n && waited < 5000; waited += 50) {
          await Bun.sleep(50);
          // Re-read each tick: the array is autoreleased and the pump drains the pool.
          const windows = rt.msgSend(nsApp, rt.selectors.get('windows'));
          const count = msgSendReturnsI64(windows, rt.selectors.get('count'));
          for (let i = 0n; i < count && sheet === 0n; i += 1n) {
            host = msgSendI64(windows, rt.selectors.get('objectAtIndex:'), i);
            sheet = rt.msgSend(host, rt.selectors.get('attachedSheet'));
          }
        }
        expect(sheet).not.toBe(0n);
        msgSendPtrI64(host, rt.selectors.get('endSheet:returnCode:'), sheet, 1000n);
        let title: unknown = '';
        for (let waited = 0; title !== 'true' && waited < 5000; waited += 50) {
          await Bun.sleep(50);
          title = await win.webContents.executeJavaScript('document.title');
        }
        expect(title).toBe('true');
      } finally {
        win.close();
        app.quit();
      }
    });

    test('window.open hands the target URL to the handler and creates no child view', () => {
      const seen: string[] = [];
      const delegate = createUIDelegate((url) => seen.push(url));
      const created = msgSendPtr4(
        delegate.handle,
        cocoa().selectors.get(
          'webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:',
        ),
        0n,
        0n,
        navigationAction('https://example.com/popup'),
        0n,
      );
      expect(created).toBe(0n);
      expect(seen).toEqual(['https://example.com/popup']);
      delegate.destroy();
    });
  });
}
