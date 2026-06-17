import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { decodeEnvelope } from '../../../src/main/ipc/ipc-protocol';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import type { NativeApplication, NativeWebContents } from '../../../src/main/platform/native';

/**
 * Split-eval proof on a real WKWebView: the PUBLIC `executeJavaScript` runs in
 * the PAGE world (Electron semantics), while internal dispatch
 * (`sendEnvelopeToRenderer`) runs in the ISOLATED world. They have separate
 * globals: a global set by `executeJavaScript` is invisible to the isolated
 * preload, and vice versa.
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('split eval semantics over a real webview', () => {
    let app: NativeApplication;
    let contents: NativeWebContents;
    const received: string[] = [];

    // Isolated-world preload: sets its own global and, on request, reports both
    // its own global and whether it can see the page-world global.
    const isolatedPreload = [
      'window.__isoMarker = "from-isolated";',
      "window.__bunmaska.on('report', function () {",
      '  window.__bunmaska.send(',
      "    'report-result',",
      '    window.__isoMarker,',
      '    typeof window.__pageMarker',
      '  );',
      '});',
    ].join('\n');

    beforeAll(() => {
      app = createMacOSApplication();
      app.start();
      const win = app.createWindow({
        width: 400,
        height: 300,
        title: 'split-eval',
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

    test('page-world global is invisible to the isolated world (and vice versa)', async () => {
      contents.loadHTML('<html><body>split</body></html>', 'about:blank');

      const deadline = Date.now() + 8000;
      let report: ReturnType<typeof decodeEnvelope> | undefined;
      while (Date.now() < deadline && report === undefined) {
        // Set a global in the PAGE world via the public API (fire-and-forget;
        // swallow a late teardown rejection).
        contents.executeJavaScript('window.__pageMarker = "from-page";').catch(() => undefined);
        await delay(60);
        // Ask the ISOLATED world to report; dispatch lands in the isolated world.
        contents.sendEnvelopeToRenderer(
          JSON.stringify({ kind: 'send', channel: 'report', args: [] }),
        );
        await delay(120);
        report = find((e) => e.kind === 'send' && e.channel === 'report-result');
      }

      expect(report).toBeDefined();
      // args[0] = the isolated world's OWN global (present);
      // args[1] = typeof the page-world global as seen from the isolated world
      //           (must be 'undefined' — separate globals).
      expect(report).toMatchObject({
        kind: 'send',
        channel: 'report-result',
        args: ['from-isolated', 'undefined'],
      });
    });
  });
}
