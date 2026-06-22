import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import type { NativeApplication, NativeWebContents } from '../../../src/main/platform/native';

/**
 * `WebContents.executeJavaScript` round-trip on a real WKWebView.
 *
 * The completion value returns out-of-band through a page-world `bunmaskaExec`
 * script-message handler (a completion-handler block crashes Bun, D022). Proves
 * an expression, a Promise, an object, and a throw all settle the returned
 * Promise correctly. The page is loaded (and the run loop pumped) before the
 * assertions so the page-world handler binding exists.
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('executeJavaScript over a real webview', () => {
    let app: NativeApplication;
    let contents: NativeWebContents;

    beforeAll(async () => {
      app = createMacOSApplication();
      app.start();
      const win = app.createWindow({ width: 400, height: 300, title: 'exec-js', show: true });
      contents = win.webContents;
      contents.loadHTML('<html><body>exec</body></html>', 'about:blank');
      // Pump the run loop until the page (and its page-world handler) is live.
      await delay(400);
    });

    afterAll(() => {
      app.quit();
    });

    test('an expression resolves to its value', async () => {
      expect(await contents.executeJavaScript('1 + 1')).toBe(2);
    });

    test('a resolved Promise resolves to its fulfilled value', async () => {
      expect(await contents.executeJavaScript('Promise.resolve("hi")')).toBe('hi');
    });

    test('an object result round-trips via JSON', async () => {
      expect(await contents.executeJavaScript('({ a: 1, b: [2, 3], c: "x" })')).toEqual({
        a: 1,
        b: [2, 3],
        c: 'x',
      });
    });

    test('a thrown error rejects the Promise with its message', async () => {
      await expect(contents.executeJavaScript('throw new Error("boom")')).rejects.toThrow(/boom/);
    });
  });
}
