import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import { createNavigationDelegate } from '../../../src/main/platform/macos/cocoa-navigation-delegate';
import type { NativeApplication } from '../../../src/main/platform/native';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('createNavigationDelegate', () => {
    test('returns a non-null delegate instance handle', () => {
      expect(createNavigationDelegate(() => undefined).handle).not.toBe(0n);
    });

    test('distinct delegates get distinct instance handles', () => {
      const a = createNavigationDelegate(() => undefined);
      const b = createNavigationDelegate(() => undefined);
      expect(a.handle).not.toBe(b.handle);
    });
  });

  describe('did-finish-load fires on a real page load', () => {
    let app: NativeApplication;

    beforeAll(() => {
      app = createMacOSApplication();
      app.start();
    });

    afterAll(() => {
      app.quit();
    });

    test('onDidFinishLoad runs after loadHTML completes', async () => {
      const win = app.createWindow({ width: 400, height: 300, title: 'nav', show: true });
      let loads = 0;
      win.webContents.onDidFinishLoad(() => {
        loads += 1;
      });
      win.webContents.loadHTML('<html><body>nav</body></html>', 'about:blank');
      const deadline = Date.now() + 4000;
      while (loads === 0 && Date.now() < deadline) {
        await delay(50);
      }
      expect(loads).toBeGreaterThan(0);
    });
  });
}
