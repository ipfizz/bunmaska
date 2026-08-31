import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';

/**
 * `webContents.capturePage` on a real WebKitGTK view: snapshot the visible
 * viewport and assert real PNG bytes come back. Runs only in CI ubuntu under
 * `xvfb-run -a`; inert elsewhere via `describe.skipIf`.
 */

const isLinux = process.platform === 'linux';

const pump = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pumpUntil = async (predicate: () => boolean, budgetMs: number): Promise<void> => {
  const step = 20;
  for (let waited = 0; waited < budgetMs && !predicate(); waited += step) {
    await pump(step);
  }
};

describe.skipIf(!isLinux)('capturePage over a real WebKitGTK webview', () => {
  test('resolves non-empty bytes starting with the PNG signature', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window = app.createWindow({ width: 400, height: 300, title: 'capture', show: true });
    const contents = window.webContents;
    try {
      let didFinish = false;
      contents.onNavigation((event) => {
        if (event.type === 'did-finish-load') {
          didFinish = true;
        }
      });
      contents.loadHTML(
        '<!doctype html><html><body style="background:#ff0000">capture</body></html>',
        'about:blank',
      );
      await pumpUntil(() => didFinish, 20000);
      expect(didFinish).toBe(true);

      const promise = contents.capturePage();
      let settled = false;
      void promise
        .catch(() => undefined)
        .finally(() => {
          settled = true;
        });
      await pumpUntil(() => settled, 30000);
      const png = await promise;
      expect(png.length).toBeGreaterThan(8);
      expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    } finally {
      window.close();
      await pump(100);
      app.quit();
    }
  });
});
