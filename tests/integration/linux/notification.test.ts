import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { linuxNotificationBackend } from '../../../src/main/platform/linux/gtk-notification';
import { loadLibnotifyFFI } from '../../../src/main/platform/linux/libnotify-ffi';

// CI has no notification daemon, so show returns FALSE there: these prove init and the
// no-daemon release path, not that a banner appeared.
describe.skipIf(currentPlatform() !== 'linux')('Linux notification backend (libnotify)', () => {
  test('isSupported() initialises libnotify without a daemon', () => {
    expect(linuxNotificationBackend.isSupported()).toBe(true);
    expect(loadLibnotifyFFI().symbols.notify_is_initted()).not.toBe(0);
  });

  test('present, onClosed and a repeated close run clean without a daemon', () => {
    const handle = linuxNotificationBackend.present({
      title: 'Bunmaska test',
      body: 'Integration body',
      subtitle: '',
      silent: true,
    });
    handle.onClosed(() => undefined);
    handle.close();
    expect(() => handle.close()).not.toThrow();
  });
});
