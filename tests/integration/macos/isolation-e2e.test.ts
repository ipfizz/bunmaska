import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { decodeEnvelope } from '../../../src/main/ipc/ipc-protocol';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import type { NativeApplication, NativeWebContents } from '../../../src/main/platform/native';

/**
 * Isolation proof on a real WKWebView.
 *
 * The `__bunmaska` bridge + user preload run in the isolated `BunmaskaPreload`
 * world; the page world cannot see them. We prove this two ways:
 *  - the isolated-world preload registers an `iso-typeof` listener that posts
 *    `typeof window.__bunmaska` back over IPC — it answers `'object'`.
 *  - a PAGE-world `executeJavaScript` probe checks `typeof window.__bunmaska` and
 *    posts the result onto the DOM (a CustomEvent the isolated preload relays
 *    back over IPC) — it answers `'undefined'`.
 *
 * The page world genuinely has no bridge handle, so the only channel both worlds
 * share is the DOM — exactly the Phase B cross-world mechanism.
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('context isolation end-to-end over a real webview', () => {
    let app: NativeApplication;
    let contents: NativeWebContents;
    const received: string[] = [];

    // The isolated-world preload: it sees __bunmaska, and it relays the page
    // world's DOM probe back over IPC. The page world shares the DOM but not the
    // bridge, so the relay listener must live here (isolated world).
    const isolatedPreload = [
      "window.__bunmaska.on('iso-typeof-req', function () {",
      "  window.__bunmaska.send('iso-typeof', typeof window.__bunmaska);",
      '});',
      "document.addEventListener('bunmaska-page-typeof', function (e) {",
      "  window.__bunmaska.send('page-typeof', e.detail);",
      '});',
    ].join('\n');

    beforeAll(() => {
      app = createMacOSApplication();
      app.start();
      const win = app.createWindow({
        width: 400,
        height: 300,
        title: 'isolation',
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

    test('isolated world sees __bunmaska as object; page world sees undefined', async () => {
      contents.loadHTML('<html><body>iso</body></html>', 'about:blank');

      // PAGE-world probe: executeJavaScript runs in the page world. typeof of an
      // undeclared global is 'undefined' (no ReferenceError), so this is safe.
      const pageProbe =
        "document.dispatchEvent(new CustomEvent('bunmaska-page-typeof', { detail: typeof window.__bunmaska }));";

      const deadline = Date.now() + 8000;
      let isolated: ReturnType<typeof decodeEnvelope> | undefined;
      let pageTypeof: ReturnType<typeof decodeEnvelope> | undefined;
      while (Date.now() < deadline && (isolated === undefined || pageTypeof === undefined)) {
        // Ask the isolated world to report its view of __bunmaska.
        contents.sendEnvelopeToRenderer(
          JSON.stringify({ kind: 'send', channel: 'iso-typeof-req', args: [] }),
        );
        // Run the page-world probe; the isolated preload relays the DOM event.
        // Fire-and-forget; swallow a late teardown rejection.
        contents.executeJavaScript(pageProbe).catch(() => undefined);
        await delay(120);
        isolated = find((e) => e.kind === 'send' && e.channel === 'iso-typeof');
        pageTypeof = find((e) => e.kind === 'send' && e.channel === 'page-typeof');
      }

      expect(isolated).toBeDefined();
      expect(isolated).toMatchObject({ kind: 'send', channel: 'iso-typeof', args: ['object'] });

      expect(pageTypeof).toBeDefined();
      expect(pageTypeof).toMatchObject({
        kind: 'send',
        channel: 'page-typeof',
        args: ['undefined'],
      });
    });
  });
}
