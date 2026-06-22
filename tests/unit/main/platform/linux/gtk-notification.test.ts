import { describe, expect, it } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  CLOSED_CB_DEF,
  linuxNotificationBackend,
} from '../../../../../src/main/platform/linux/gtk-notification';

/**
 * Cross-platform-safe unit assertions for the Linux notification backend: the
 * `closed`-signal callback ABI shape (pure JS) and that the backend stays
 * importable on macOS, dispatching to the Linux-only loader lazily (so it throws
 * only when invoked off-Linux, never at import).
 */

describe('CLOSED_CB_DEF (NotifyNotification::closed ABI shape)', () => {
  it('is (notification, user_data) -> void', () => {
    expect(CLOSED_CB_DEF.args).toEqual(['ptr', 'ptr']);
    expect(CLOSED_CB_DEF.returns).toBe('void');
  });
});

describe('linuxNotificationBackend on a non-Linux host', () => {
  it('exposes isSupported and present', () => {
    expect(typeof linuxNotificationBackend.isSupported).toBe('function');
    expect(typeof linuxNotificationBackend.present).toBe('function');
  });

  it('isSupported() returns false off-Linux instead of throwing (caught lazily)', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(linuxNotificationBackend.isSupported()).toBe(false);
  });

  it('present() throws UnsupportedPlatformError off-Linux (lazy loader)', () => {
    if (currentPlatform() === 'linux') {
      return;
    }
    expect(() =>
      linuxNotificationBackend.present({ title: 't', body: '', subtitle: '', silent: false }),
    ).toThrow(UnsupportedPlatformError);
  });
});
