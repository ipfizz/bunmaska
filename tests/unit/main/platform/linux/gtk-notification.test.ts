import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import { linuxNotificationBackend } from '../../../../../src/main/platform/linux/gtk-notification';

const isLinux = currentPlatform() === 'linux';

describe('linuxNotificationBackend off Linux', () => {
  test.skipIf(isLinux)('isSupported() returns false instead of throwing', () => {
    expect(linuxNotificationBackend.isSupported()).toBe(false);
  });

  test.skipIf(isLinux)('present() throws UnsupportedPlatformError from the lazy loader', () => {
    expect(() =>
      linuxNotificationBackend.present({ title: 't', body: '', subtitle: '', silent: false }),
    ).toThrow(UnsupportedPlatformError);
  });
});
