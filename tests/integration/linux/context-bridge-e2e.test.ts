import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow } from '../../../src/main/platform/native';

/**
 * Phase B proof on real GTK4 + WebKitGTK 6.0: a contextBridge surface exposed in
 * the ISOLATED `BunmaskaPreload` world via the REAL
 * `window.__bunmaska.exposeInMainWorld` is callable from the PAGE world via the
 * cross-world DOM channel (Promise), AND the page cannot reach `__bunmaska`. If the
 * isolated host injection regressed, `exposeInMainWorld` would be undefined and
 * this test would time out — so it exercises the actual injected host.
 *
 * Runs only in CI ubuntu under `xvfb-run -a`. Inert on macOS via
 * `describe.skipIf`.
 */

const isLinux = process.platform === 'linux';

const pump = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const pumpUntil = async (predicate: () => boolean, budgetMs: number): Promise<void> => {
  const step = 20;
  for (let waited = 0; waited < budgetMs && !predicate(); waited += step) {
    await pump(step);
  }
};

describe.skipIf(!isLinux)('Linux contextBridge cross-world proxy', () => {
  test('page calls window.myApi.add (Promise) and cannot see __bunmaska', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }

    const isolatedPreload = [
      "window.__bunmaska.exposeInMainWorld('myApi', {",
      '  add: function (a, b) { return a + b; },',
      '  version: 7,',
      '});',
      "document.addEventListener('cb-result', function (e) {",
      "  window.__bunmaska.send('cb-result', e.detail);",
      '});',
      "document.addEventListener('cb-bunmaska-typeof', function (e) {",
      "  window.__bunmaska.send('cb-bunmaska-typeof', e.detail);",
      '});',
    ].join('\n');

    const app = createLinuxApplication();
    app.start();

    const window: NativeWindow = app.createWindow({
      width: 320,
      height: 240,
      title: 'Linux ContextBridge E2E',
      show: true,
      preloadScript: isolatedPreload,
    });
    const contents = window.webContents;

    const received: string[] = [];
    contents.onRendererEnvelope((json) => received.push(json));

    let didFinish = false;
    contents.onNavigation((navEvent) => {
      if (navEvent.type !== 'did-finish-load') {
        return;
      }
      didFinish = true;
    });

    // Page (main world) script: call the proxied method and probe __bunmaska.
    const html =
      '<!doctype html><html><body><script>' +
      "document.dispatchEvent(new CustomEvent('cb-bunmaska-typeof', { detail: typeof window.__bunmaska }));" +
      'if (window.myApi && typeof window.myApi.add === "function") {' +
      '  window.myApi.add(20, 22).then(function (r) {' +
      "    document.dispatchEvent(new CustomEvent('cb-result', { detail: { value: r, version: window.myApi.version } }));" +
      '  });' +
      '}' +
      '</script></body></html>';
    contents.loadHTML(html);

    await pumpUntil(() => didFinish, 5000);
    expect(didFinish).toBe(true);

    const find = (channel: string): { args?: unknown[] } | undefined => {
      for (const json of received) {
        const env = JSON.parse(json) as { kind: string; channel?: string; args?: unknown[] };
        if (env.kind === 'send' && env.channel === channel) {
          return env;
        }
      }
      return undefined;
    };

    await pumpUntil(
      () => find('cb-result') !== undefined && find('cb-bunmaska-typeof') !== undefined,
      8000,
    );

    const result = find('cb-result');
    const bunmaskaTypeof = find('cb-bunmaska-typeof');
    expect(result).toBeDefined();
    expect(result?.args?.[0]).toMatchObject({ value: 42, version: 7 });
    expect(bunmaskaTypeof).toBeDefined();
    expect(bunmaskaTypeof?.args).toEqual(['undefined']);

    window.close();
    await pump(100);
    app.quit();
  });
});
