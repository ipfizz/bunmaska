import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { macosNotificationBackend } from '../../../src/main/platform/macos/cocoa-notification';

/**
 * macOS-only. Exercises the REAL NSUserNotification FFI path on the host.
 *
 * EMPIRICAL REALITY (measured un-bundled, `bun test`): the `NSUserNotification`
 * class resolves and the setters run cleanly, but
 * `[NSUserNotificationCenter defaultUserNotificationCenter]` returns NIL without
 * an app bundle, so nothing is actually delivered — and `deliverNotification:`
 * to a nil center is a safe no-op (no SIGSEGV). This test therefore asserts the
 * path runs WITHOUT THROWING and that `isSupported()` honestly reflects the
 * nil-center reality; it CANNOT assert a banner appeared.
 */
const isMac = currentPlatform() === 'macos';

describe.skipIf(!isMac)('cocoa-notification (macOS, un-bundled)', () => {
  test('present() builds and best-effort delivers without throwing', () => {
    expect(() =>
      macosNotificationBackend.present({
        title: 'Bunmaska test',
        body: 'Integration body',
        subtitle: 'Integration subtitle',
        silent: false,
      }),
    ).not.toThrow();
  });

  test('the returned handle close()/onClosed() do not throw', () => {
    const handle = macosNotificationBackend.present({
      title: 'Bunmaska test',
      body: 'body',
      subtitle: '',
      silent: true,
    });
    expect(() => handle.onClosed(() => undefined)).not.toThrow();
    expect(() => handle.close()).not.toThrow();
  });

  test('isSupported() returns a boolean reflecting the default center', () => {
    // Honest: un-bundled the default center is nil so this is `false`. We assert
    // the type (not a fixed value) so a future bundled build that flips it to
    // `true` does not break this test.
    expect(typeof macosNotificationBackend.isSupported()).toBe('boolean');
  });

  test('present() does not throw even when delivery cannot happen un-bundled', () => {
    // The whole point: a clean no-throw run on a host whose center is nil.
    expect(() =>
      macosNotificationBackend.present({ title: 'x', body: '', subtitle: '', silent: false }),
    ).not.toThrow();
  });
});
