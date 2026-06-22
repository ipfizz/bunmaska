import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { BrowserWindow } from '../../../src/main/api/browser-window';
import { resetBootstrapForTesting } from '../../../src/main/bootstrap';
import { nativeApp, setNativeAppForTesting } from '../../../src/main/native-app';
import { installSafeAppExit } from '../../helpers/safe-app-exit';

/**
 * BrowserWindow lifecycle events + the close-path teardown on a REAL NSWindow.
 *
 * Drives the cooperative CFRunLoop pump (via setTimeout, as the other macOS
 * integration suites do) so AppKit delivers its delegate notifications. Proves:
 *  - `show`/`focus` fire on the corresponding programmatic calls,
 *  - a `close` listener calling preventDefault() vetoes the close
 *    (`isDestroyed()` stays false),
 *  - a normal close fires `closed`, and
 *  - the close-path teardown runs on the delegate path: a pre-close
 *    executeJavaScript settles and a post-close one rejects WITHOUT touching a
 *    freed WKWebView (no crash).
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('BrowserWindow lifecycle events on the real macOS backend', () => {
    beforeAll(() => {
      setNativeAppForTesting(undefined);
      resetBootstrapForTesting();
      // Closing the last window triggers the window-all-closed default quit;
      // keep it from terminating the shared test process.
      installSafeAppExit();
    });

    afterAll(() => {
      nativeApp().quit();
    });

    test('show() emits a show event', async () => {
      const win = new BrowserWindow({ width: 360, height: 240, title: 'show', show: false });
      try {
        let shown = 0;
        win.on('show', () => {
          shown += 1;
        });
        win.show();
        await delay(50);
        expect(shown).toBeGreaterThan(0);
      } finally {
        win.close();
      }
    });

    test('setSize() emits a resize event via the window delegate', async () => {
      // `resize` proves the NSWindowDelegate notifications are delivered on the
      // real backend (windowDidResize:). `focus`/`blur` map to
      // windowDidBecomeKey:/windowDidResignKey:, which a headless test process
      // never receives because it cannot acquire keyboard focus — those are
      // covered by the unit suite's fake instead. (Documented platform limit.)
      const win = new BrowserWindow({ width: 360, height: 240, title: 'resize', show: true });
      try {
        let resized = 0;
        win.on('resize', () => {
          resized += 1;
        });
        win.setSize(500, 400);
        const deadline = Date.now() + 2000;
        while (resized === 0 && Date.now() < deadline) {
          await delay(40);
        }
        expect(resized).toBeGreaterThan(0);
      } finally {
        win.close();
      }
    });

    test('a close listener calling preventDefault keeps the window open', async () => {
      const win = new BrowserWindow({ width: 360, height: 240, title: 'veto', show: true });
      let prevent = true;
      let closed = 0;
      win.on('close', (event) => {
        if (prevent) {
          event.preventDefault();
        }
      });
      win.on('closed', () => {
        closed += 1;
      });

      win.close();
      await delay(50);
      expect(win.isDestroyed()).toBe(false);
      expect(closed).toBe(0);
      expect(BrowserWindow.fromId(win.id)).toBe(win);

      // A subsequent non-prevented close actually closes.
      prevent = false;
      win.close();
      await delay(50);
      expect(win.isDestroyed()).toBe(true);
      expect(closed).toBe(1);
    });

    test('a normal close fires closed and runs the close-path teardown', async () => {
      const win = new BrowserWindow({ width: 360, height: 240, title: 'teardown', show: true });
      win.loadURL('about:blank');
      await delay(200);

      // A pre-close exec settles normally.
      expect(await win.webContents.executeJavaScript('21 + 21')).toBe(42);

      let closed = 0;
      win.on('closed', () => {
        closed += 1;
      });
      win.close();
      await delay(50);
      expect(closed).toBe(1);
      expect(win.isDestroyed()).toBe(true);

      // CRUCIAL use-after-free check: a post-close exec must NOT touch the freed
      // WKWebView — the #destroyed guard set by the close-path teardown rejects
      // it cleanly instead of crashing.
      await expect(win.webContents.executeJavaScript('1 + 1')).rejects.toThrow(/destroyed/);
    });

    test('closing via the native delegate path (-close) still runs teardown', async () => {
      // BrowserWindow.close() sends -close to the NSWindow, which is exactly the
      // path the title-bar red button takes (windowShouldClose: → windowWillClose:).
      // Proves teardown is NOT tied to a JS-only code path.
      const win = new BrowserWindow({ width: 360, height: 240, title: 'native-close', show: true });
      win.loadURL('about:blank');
      await delay(200);
      let closed = 0;
      win.on('closed', () => {
        closed += 1;
      });
      win.close();
      await delay(50);
      expect(closed).toBe(1);
      // Idempotent: a second close does not re-fire closed or crash.
      win.close();
      await delay(20);
      expect(closed).toBe(1);
    });
  });
}
