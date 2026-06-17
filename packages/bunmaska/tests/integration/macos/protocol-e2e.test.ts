import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { protocol } from '../../../src/main/api/protocol';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import type { NativeApplication, NativeWebContents } from '../../../src/main/platform/native';

/**
 * End-to-end proof that a custom `app://` scheme serves content on a real
 * WKWebView.
 *
 * `protocol.handle('app', ...)` is registered BEFORE the window is created (the
 * scheme handler can only be set on the `WKWebViewConfiguration` before the view
 * exists). The view loads `app://host/index.html`; the `WKURLSchemeHandler` IMP
 * reads the request URL, dispatches it through the protocol registry, and serves
 * the bytes via NSData + NSURLResponse. We pump until did-finish-load, then read
 * the served DOM back with `executeJavaScript` — proving the bytes round-tripped
 * through the custom scheme into a live document.
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pumpUntil = async (predicate: () => boolean, budgetMs: number): Promise<void> => {
  const step = 20;
  for (let waited = 0; waited < budgetMs && !predicate(); waited += step) {
    await delay(step);
  }
};

const SERVED_HTML = '<html><body><h1 id=x>HELLO</h1></body></html>';

if (currentPlatform() === 'macos') {
  describe('custom app:// scheme over a real WKWebView', () => {
    let app: NativeApplication;
    let contents: NativeWebContents;
    let didFinish = false;

    beforeAll(async () => {
      // Register the scheme BEFORE the window/web view exists.
      protocol.handle('app', (request) => {
        if (request.url === 'app://host/index.html') {
          return { data: SERVED_HTML, mimeType: 'text/html' };
        }
        return undefined;
      });

      app = createMacOSApplication();
      app.start();
      const win = app.createWindow({ width: 400, height: 300, title: 'protocol', show: true });
      contents = win.webContents;
      contents.onNavigation((navEvent) => {
        if (navEvent.type !== 'did-finish-load') {
          return;
        }
        didFinish = true;
      });
      contents.loadURL('app://host/index.html');
      await pumpUntil(() => didFinish, 10000);
    });

    afterAll(() => {
      app.quit();
      protocol.unhandle('app');
    });

    test('the load over the custom scheme finishes', () => {
      expect(didFinish).toBe(true);
    });

    test('the served document URL is the app:// url', () => {
      expect(contents.getURL()).toBe('app://host/index.html');
    });

    test('executeJavaScript reads the served DOM content', async () => {
      const text = await contents.executeJavaScript("document.getElementById('x').textContent");
      expect(text).toBe('HELLO');
    });
  });
}
