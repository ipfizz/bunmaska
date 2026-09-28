import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { macosNotificationBackend } from '../../../src/main/platform/macos/cocoa-notification';
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
});
