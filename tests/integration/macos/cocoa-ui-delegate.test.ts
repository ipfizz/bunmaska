import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import { msgSendPtr, msgSendPtr4 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
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

describe.skipIf(currentPlatform() !== 'macos')('BunmaskaUIDelegate', () => {
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
