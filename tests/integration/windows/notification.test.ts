import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { Notification } from '../../../src/main/api/notification';
import { windowsNotificationBackend } from '../../../src/main/platform/windows/windows-notification';

/**
 * Windows notifications against the real Shell_NotifyIcon balloon. Showing a
 * balloon briefly surfaces a toast (auto-dismissed); these exercise the
 * present/close lifecycle (Shell_NotifyIcon NIM_ADD/NIM_DELETE succeed) and the
 * public Notification wrapper. The balloon-dismissal → `close` wiring is covered
 * purely by `isBalloonDismiss` (windows-notification.test.ts). Runs only on Windows.
 */
const spec = {
  title: 'Bunmaska',
  body: 'Hello from the Windows backend',
  subtitle: '',
  silent: false,
};

if (currentPlatform() === 'windows') {
  describe('Windows notification backend', () => {
    test('isSupported is true', () => {
      expect(windowsNotificationBackend.isSupported()).toBe(true);
    });

    test('present shows a balloon and returns a closable handle', () => {
      const handle = windowsNotificationBackend.present(spec);
      expect(typeof handle.close).toBe('function');
      expect(() => handle.close()).not.toThrow();
      // close is idempotent.
      expect(() => handle.close()).not.toThrow();
    });

    test('a silent notification presents without throwing', () => {
      const handle = windowsNotificationBackend.present({ ...spec, silent: true });
      handle.close();
      expect(true).toBe(true);
    });

    test('onClosed registers a callback without firing it eagerly', () => {
      const handle = windowsNotificationBackend.present(spec);
      let closed = 0;
      handle.onClosed(() => {
        closed += 1;
      });
      expect(closed).toBe(0);
      handle.close(); // an explicit close fires onClosed
      expect(closed).toBe(1);
    });
  });

  describe('Windows public Notification (over the real backend)', () => {
    test('show emits "show" and close tears it down', () => {
      const notification = new Notification({ title: 'Bunmaska', body: 'beta' });
      let shown = 0;
      notification.on('show', () => {
        shown += 1;
      });
      notification.show();
      expect(shown).toBe(1);
      expect(() => notification.close()).not.toThrow();
    });

    test('Notification.isSupported is true on Windows', () => {
      expect(Notification.isSupported()).toBe(true);
    });
  });
}
