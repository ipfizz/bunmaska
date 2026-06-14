import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { Menu } from '../../../src/main/api/menu';
import { Tray } from '../../../src/main/api/tray';
import { resetBootstrapForTesting } from '../../../src/main/bootstrap';
import { nativeApp, setNativeAppForTesting } from '../../../src/main/native-app';

/**
 * Real NSStatusItem lifecycle on a macOS host. A status-bar click cannot be
 * synthesised headlessly, so (mirroring the menu/dialog integration tests) we
 * assert that constructing, configuring, and destroying a tray runs cleanly on
 * the real runtime without crashing, and that `isDestroyed` flips.
 *
 * `[NSStatusBar systemStatusBar]` needs a window-server connection, which is
 * established by starting the native app (NSApplication sharedApplication +
 * finishLaunching), so we start it in `beforeAll` exactly like the
 * BrowserWindow integration suite.
 *
 * A NIL icon (bad path) must NOT crash — that is asserted explicitly.
 */
if (currentPlatform() === 'macos') {
  describe('cocoa-tray', () => {
    beforeAll(() => {
      // Use the real native backend and start it so the window server connects.
      setNativeAppForTesting(undefined);
      resetBootstrapForTesting();
      nativeApp().start();
    });

    afterAll(() => {
      nativeApp().quit();
    });

    test('construct + setToolTip/setTitle + destroy runs clean and flips isDestroyed', () => {
      const tray = new Tray('/this/path/does/not/exist.png');
      try {
        expect(tray.isDestroyed()).toBe(false);
        tray.setToolTip('Bunmaska');
        tray.setTitle('S');
      } finally {
        tray.destroy();
      }
      expect(tray.isDestroyed()).toBe(true);
    });

    test('a nil image (bad path) does not crash on construct or setImage', () => {
      const tray = new Tray('/definitely/not/a/real/icon.png');
      try {
        expect(() => tray.setImage('/also/not/real.png')).not.toThrow();
      } finally {
        tray.destroy();
      }
      expect(tray.isDestroyed()).toBe(true);
    });

    test('setContextMenu with a small Menu runs clean and reuses the Menu realizer', () => {
      const tray = new Tray('/tmp/icon.png');
      const menu = Menu.buildFromTemplate([
        { label: 'Hello' },
        { type: 'separator' },
        { label: 'Quit', click: () => undefined },
      ]);
      try {
        expect(() => tray.setContextMenu(menu)).not.toThrow();
        expect(() => tray.setContextMenu(null)).not.toThrow();
      } finally {
        tray.destroy();
      }
      expect(tray.isDestroyed()).toBe(true);
    });

    test('destroy is idempotent on the real backend', () => {
      const tray = new Tray('/tmp/icon.png');
      tray.destroy();
      expect(() => tray.destroy()).not.toThrow();
      expect(tray.isDestroyed()).toBe(true);
    });
  });
}
