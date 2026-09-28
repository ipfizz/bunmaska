import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { session } from '../../../src/main/api/session';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import { nsStringToString } from '../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendI64,
  msgSendReturnsI64,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

/** The WebContent pid behind the window titled `title` (its content view is the WKWebView). */
const webProcessPid = (title: string): number => {
  const rt = cocoa();
  const app = rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
  const windows = rt.msgSend(app, rt.selectors.get('windows'));
  const count = Number(rt.msgSend(windows, rt.selectors.get('count')));
  for (let i = 0; i < count; i += 1) {
    const win = msgSendI64(windows, rt.selectors.get('objectAtIndex:'), BigInt(i));
    if (nsStringToString(rt.msgSend(win, rt.selectors.get('title'))) === title) {
      const view = rt.msgSend(win, rt.selectors.get('contentView'));
      return Number(
        BigInt.asIntN(32, msgSendReturnsI64(view, rt.selectors.get('_webProcessIdentifier'))),
      );
    }
  }
  return 0;
};

/**
 * `session.clearStorageData` against a real `WKWebsiteDataStore`. Proves the
 * void completion-handler Block (D022b) fires on the pumped run loop: the
 * removal's `^(void)` handler resolves the Promise. The app is started so the
 * cooperative pump is running while we await.
 */
if (currentPlatform() === 'macos') {
  describe('session.clearStorageData on macOS', () => {
    test('resolves when the data store removal completes (void block handler)', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        let resolved = false;
        await session.defaultSession.clearStorageData().then(() => {
          resolved = true;
        });
        expect(resolved).toBe(true);
      } finally {
        app.quit();
      }
    });

    // A hidden view's web process runs DarwinBG and gets no CPU on a saturated machine;
    // SIGSTOP stands in for that starvation deterministically.
    test('does not wait on a web process that gets no CPU', async () => {
      const app = createMacOSApplication();
      app.start();
      const win = app.createWindow({
        width: 200,
        height: 100,
        title: 'session-stopped',
        show: true,
      });
      let pid = 0;
      try {
        win.webContents.loadHTML('<html><body>x</body></html>', 'about:blank');
        await win.webContents.executeJavaScript('1');
        pid = webProcessPid('session-stopped');
        expect(pid).toBeGreaterThan(0);
        process.kill(pid, 'SIGSTOP');
        const outcome = await Promise.race([
          session.defaultSession.clearStorageData().then(() => 'resolved'),
          Bun.sleep(5000).then(() => 'pending'),
        ]);
        expect(outcome).toBe('resolved');
      } finally {
        if (pid > 0) {
          process.kill(pid, 'SIGCONT');
        }
        win.close();
        app.quit();
      }
    });
  });
}
