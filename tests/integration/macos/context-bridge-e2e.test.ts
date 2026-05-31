import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { decodeEnvelope } from '../../../src/main/ipc/ipc-protocol';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import type { NativeApplication, NativeWebContents } from '../../../src/main/platform/native';

/**
 * Phase B proof on a real WKWebView: a contextBridge surface exposed in the
 * ISOLATED world via the REAL `window.__sambar.exposeInMainWorld` is callable
 * from the PAGE world via the cross-world DOM channel, returns a Promise, AND
 * the page still cannot reach `__sambar`. If the isolated host injection
 * regressed, `exposeInMainWorld` would be undefined and this test would time
 * out — so this exercises the actual injected host end-to-end.
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('contextBridge cross-world proxy end-to-end', () => {
    let app: NativeApplication;
    let contents: NativeWebContents;
    const received: string[] = [];

    // Isolated-world preload: use the REAL exposeInMainWorld the backend
    // injects, then relay the page world's call result and its `typeof
    // __sambar` probe back over IPC.
    const isolatedPreload = [
      "window.__sambar.exposeInMainWorld('myApi', {",
      '  add: function (a, b) { return a + b; },',
      '  version: 7,',
      '});',
      // Relay the page world's findings back over IPC.
      "document.addEventListener('cb-result', function (e) {",
      "  window.__sambar.send('cb-result', e.detail);",
      '});',
      "document.addEventListener('cb-sambar-typeof', function (e) {",
      "  window.__sambar.send('cb-sambar-typeof', e.detail);",
      '});',
    ].join('\n');

    beforeAll(() => {
      app = createMacOSApplication();
      app.start();
      const win = app.createWindow({
        width: 400,
        height: 300,
        title: 'context-bridge',
        show: true,
        preloadScript: isolatedPreload,
      });
      contents = win.webContents;
      contents.onRendererEnvelope((json) => received.push(json));
    });

    afterAll(() => {
      app.quit();
    });

    const find = (
      predicate: (env: ReturnType<typeof decodeEnvelope>) => boolean,
    ): ReturnType<typeof decodeEnvelope> | undefined => {
      for (const json of received) {
        const env = decodeEnvelope(json);
        if (predicate(env)) {
          return env;
        }
      }
      return undefined;
    };

    test('page calls window.myApi.add (Promise) and cannot see __sambar', async () => {
      contents.loadHTML('<html><body>cb</body></html>', 'about:blank');

      // PAGE-world script: call the exposed (proxied) method and report both its
      // resolved value and the page's view of __sambar, via the shared DOM.
      const pageScript = [
        '(function () {',
        "  document.dispatchEvent(new CustomEvent('cb-sambar-typeof', { detail: typeof window.__sambar }));",
        '  if (window.myApi && typeof window.myApi.add === "function") {',
        '    window.myApi.add(20, 22).then(function (r) {',
        "      document.dispatchEvent(new CustomEvent('cb-result', { detail: { value: r, version: window.myApi.version } }));",
        '    });',
        '  }',
        '})();',
      ].join('\n');

      const deadline = Date.now() + 8000;
      let result: ReturnType<typeof decodeEnvelope> | undefined;
      let sambarTypeof: ReturnType<typeof decodeEnvelope> | undefined;
      while (Date.now() < deadline && (result === undefined || sambarTypeof === undefined)) {
        contents.executeJavaScript(pageScript);
        await delay(150);
        result = find((e) => e.kind === 'send' && e.channel === 'cb-result');
        sambarTypeof = find((e) => e.kind === 'send' && e.channel === 'cb-sambar-typeof');
      }

      expect(result).toBeDefined();
      // args[0].value = the proxied add(20,22); args[0].version = cloned data value.
      const resultArgs = result?.kind === 'send' ? result.args : [];
      expect(resultArgs[0]).toMatchObject({ value: 42, version: 7 });

      // The page world still cannot reach the isolated bridge.
      expect(sambarTypeof).toBeDefined();
      expect(sambarTypeof).toMatchObject({
        kind: 'send',
        channel: 'cb-sambar-typeof',
        args: ['undefined'],
      });
    });
  });
}
