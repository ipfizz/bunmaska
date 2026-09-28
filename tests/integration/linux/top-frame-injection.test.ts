import { describe, expect, test } from 'bun:test';
import { requireGtkDisplay } from '../../helpers/require-gtk-display';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';

/** Electron runs preloads and dom-ready in the main frame only (nodeIntegrationInSubFrames off). */

const isLinux = process.platform === 'linux';

const pumpUntil = async (predicate: () => boolean, budgetMs: number): Promise<void> => {
  for (let waited = 0; waited < budgetMs && !predicate(); waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe.skipIf(!isLinux)('Linux injection is top-frame only', () => {
  test('an iframe gets no preload, no exposed API and no dom-ready', async () => {
    requireGtkDisplay();
    const app = createLinuxApplication();
    app.start();
    const window = app.createWindow({
      width: 320,
      height: 240,
      title: 'Top Frame Only',
      show: true,
      preloadScript:
        "window.__bunmaska.exposeInMainWorld('api', { ok: 1 });\n" +
        "window.__bunmaska.send('preload-ran', location.href);",
    });
    const contents = window.webContents;
    const preloadRuns: string[] = [];
    contents.onRendererEnvelope((json) => {
      const env = JSON.parse(json) as { channel?: string };
      if (env.channel === 'preload-ran') {
        preloadRuns.push(json);
      }
    });
    let domReady = 0;
    let didFinish = false;
    contents.onNavigation((event) => {
      if (event.type === 'dom-ready') {
        domReady += 1;
      } else if (event.type === 'did-finish-load') {
        didFinish = true;
      }
    });

    contents.loadHTML('<!doctype html><body><iframe srcdoc="<p>child</p>"></iframe></body>');
    await pumpUntil(() => didFinish, 5000);
    const childApi = await contents.executeJavaScript('typeof frames[0].api');

    expect(didFinish).toBe(true);
    expect(childApi).toBe('undefined');
    expect(preloadRuns).toHaveLength(1);
    expect(domReady).toBe(1);

    window.close();
    app.quit();
  });
});
