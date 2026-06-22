import { afterEach, describe, expect, test } from 'bun:test';
import { Tray, setTrayBackendForTesting } from '../../../../src/main/api/tray';

/**
 * The Linux Tray is now a StatusNotifierItem over D-Bus, gated behind
 * `BUNMASKA_ENABLE_LINUX_TRAY`. WITHOUT the gate (and in CI), constructing a Tray must be a
 * safe INERT no-op — NOT a throw — so cross-platform code can build a Tray unconditionally.
 *
 * Overriding `process.platform` drives the Linux dispatch branch on any host; with the gate
 * unset the backend returns its inert instance before any FFI, so this is safe off-Linux.
 */

const original = Object.getOwnPropertyDescriptor(process, 'platform');

const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value, configurable: true });
};

afterEach(() => {
  setTrayBackendForTesting(undefined);
  if (original) {
    Object.defineProperty(process, 'platform', original);
  }
});

describe('Tray on Linux (gated-off no-op)', () => {
  test('constructing a Tray does NOT throw when the gate is off', () => {
    setPlatform('linux');
    expect(process.env['BUNMASKA_ENABLE_LINUX_TRAY']).not.toBe('1');
    expect(() => new Tray('/tmp/icon.png')).not.toThrow();
  });

  test('every method is a safe no-op and destroy is idempotent', () => {
    setPlatform('linux');
    const tray = new Tray('/tmp/icon.png');
    expect(() => {
      tray.setToolTip('hi');
      tray.setTitle('t');
      tray.setImage('/tmp/other.png');
      tray.setContextMenu(null);
    }).not.toThrow();
    expect(tray.isDestroyed()).toBe(false);
    tray.destroy();
    expect(tray.isDestroyed()).toBe(true);
    expect(() => tray.destroy()).not.toThrow();
  });
});
