import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendPtrPtr } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import {
  macosNotificationBackend,
  notificationDelegate,
} from '../../../src/main/platform/macos/cocoa-notification';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

const isMac = currentPlatform() === 'macos';

describe.skipIf(!isMac)('cocoa-notification', () => {
  // Un-bundled (bun test) the default center is nil, so nothing is delivered.
  test('present() and its handle run without throwing', () => {
    const handle = macosNotificationBackend.present({
      title: 'Bunmaska test',
      body: 'body',
      subtitle: 'subtitle',
      silent: false,
    });
    expect(() => handle.onClosed(() => undefined)).not.toThrow();
    expect(() => handle.close()).not.toThrow();
  });

  test('isSupported() is true exactly when the process has a bundle identifier', () => {
    const rt = cocoa();
    const bundle = rt.msgSend(rt.classes.get('NSBundle'), rt.selectors.get('mainBundle'));
    const bundled = rt.msgSend(bundle, rt.selectors.get('bundleIdentifier')) !== 0n;
    expect(macosNotificationBackend.isSupported()).toBe(bundled);
  });

  test('the center delegate asks AppKit to show banners while the app is frontmost', () => {
    const shouldPresent = msgSendPtrPtr(
      notificationDelegate(),
      cocoa().selectors.get('userNotificationCenter:shouldPresentNotification:'),
      0n,
      0n,
    );
    expect(shouldPresent & 0xffn).toBe(1n);
  });
});
