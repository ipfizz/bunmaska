import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { nsString, nsStringToString } from '../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendInitWithContentRect,
  msgSendInitWithFrameConfig,
  msgSendPtr,
  msgSendRectU8,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { loadWebKit } from '../../../src/main/platform/macos/cocoa-webkit';

const NS_BACKING_STORE_BUFFERED = 2n;
const BORDERLESS = 0n;

/** The receiver's `frame` as NSValue prints it: KVC boxes the struct, so no struct return. */
const frameOf = (receiver: bigint): string => {
  const rt = cocoa();
  const boxed = msgSendPtr(receiver, rt.selectors.get('valueForKey:'), nsString('frame'));
  return nsStringToString(rt.msgSend(boxed, rt.selectors.get('description')));
};

const borderlessWindow = (rect: readonly [number, number, number, number]): bigint => {
  const rt = cocoa();
  return msgSendInitWithContentRect(
    rt.msgSend(rt.classes.get('NSWindow'), rt.selectors.get('alloc')),
    rt.selectors.get('initWithContentRect:styleMask:backing:defer:'),
    rect,
    BORDERLESS,
    NS_BACKING_STORE_BUFFERED,
    false,
  );
};

describe.skipIf(currentPlatform() !== 'macos')('CGRect by value (D018)', () => {
  test('initWithContentRect:styleMask:backing:defer: receives the rect intact', () => {
    const window = borderlessWindow([100, 110, 400, 300]);
    expect(frameOf(window)).toBe('NSRect: {{100, 110}, {400, 300}}');
    cocoa().msgSend(window, cocoa().selectors.get('release'));
  });

  test('setFrame:display: receives the rect intact', () => {
    const rt = cocoa();
    const window = borderlessWindow([0, 0, 50, 50]);
    msgSendRectU8(window, rt.selectors.get('setFrame:display:'), [10, 20, 300, 200], false);
    expect(frameOf(window)).toBe('NSRect: {{10, 20}, {300, 200}}');
    rt.msgSend(window, rt.selectors.get('release'));
  });

  test('WKWebView initWithFrame:configuration: receives the rect intact', () => {
    loadWebKit();
    const rt = cocoa();
    const config = rt.msgSend(
      rt.msgSend(rt.classes.get('WKWebViewConfiguration'), rt.selectors.get('alloc')),
      rt.selectors.get('init'),
    );
    const webview = msgSendInitWithFrameConfig(
      rt.msgSend(rt.classes.get('WKWebView'), rt.selectors.get('alloc')),
      rt.selectors.get('initWithFrame:configuration:'),
      [5, 6, 320, 240],
      config,
    );
    expect(frameOf(webview)).toBe('NSRect: {{5, 6}, {320, 240}}');
    rt.msgSend(webview, rt.selectors.get('release'));
    rt.msgSend(config, rt.selectors.get('release'));
  });
});
