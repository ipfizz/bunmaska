import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { IpcMainImpl } from '../../../src/main/api/ipc-main';
import { decodeEnvelope, encodeEnvelope } from '../../../src/main/ipc/ipc-protocol';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import type { NativeApplication, NativeWindow } from '../../../src/main/platform/native';

/**
 * IPC end-to-end over a real WKWebView.
 *
 * `__bunmaska` now lives in the ISOLATED `BunmaskaPreload` world (context
 * isolation), so the renderer-side test logic ships as a PRELOAD (which runs in
 * that world) and is triggered via `sendEnvelopeToRenderer` (which also targets
 * the isolated world). Page-world `executeJavaScript` can no longer reach
 * `__bunmaska` — that is the isolation guarantee, proven in `isolation-e2e.test.ts`.
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('IPC end-to-end over a real webview', () => {
    let app: NativeApplication;

    beforeAll(() => {
      app = createMacOSApplication();
      app.start();
    });

    afterAll(() => {
      app.quit();
    });

    /**
     * Drive the isolated-world preload (via `sendEnvelopeToRenderer`) until an
     * envelope matching `predicate` arrives. Re-dispatching each poll is robust
     * to load/preload timing on slow CI runners.
     */
    const driveUntilEnvelope = async (
      win: NativeWindow,
      received: readonly string[],
      triggerChannel: string,
      predicate: (env: ReturnType<typeof decodeEnvelope>) => boolean,
      timeoutMs = 5000,
    ): Promise<ReturnType<typeof decodeEnvelope> | undefined> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        win.webContents.sendEnvelopeToRenderer(
          encodeEnvelope({ kind: 'send', channel: triggerChannel, args: [] }),
        );
        await delay(100);
        for (const json of received) {
          const env = decodeEnvelope(json);
          if (predicate(env)) {
            return env;
          }
        }
      }
      return undefined;
    };

    test('renderer -> main: postMessage reaches the native script message handler', async () => {
      // Preload runs in the isolated world; on 'go' it posts a send envelope.
      const preload = [
        "window.__bunmaska.on('go', function () {",
        "  window.__bunmaska.send('hello', 1, 2);",
        '});',
      ].join('\n');
      const win = app.createWindow({
        width: 400,
        height: 300,
        title: 'ipc',
        show: true,
        preloadScript: preload,
      });
      const received: string[] = [];
      win.webContents.onRendererEnvelope((json) => received.push(json));
      win.webContents.loadHTML('<html><body>ipc</body></html>', 'about:blank');

      const env = await driveUntilEnvelope(
        win,
        received,
        'go',
        (e) => e.kind === 'send' && e.channel === 'hello',
      );
      expect(env).toMatchObject({ kind: 'send', channel: 'hello', args: [1, 2] });
    });

    test('invoke round-trip: page invoke -> ipcMain.handle -> reply settles the page promise', async () => {
      const ipc = new IpcMainImpl();
      ipc.handle('add', (_event, a, b) => (a as number) + (b as number));

      // Preload (isolated world): on 'go' it invokes 'add' once and reports the
      // resolved value back on 'result'. A guard flag keeps the retry idempotent.
      const preload = [
        "window.__bunmaska.on('go', function () {",
        '  if (window.__sentInvoke) { return; }',
        '  window.__sentInvoke = true;',
        "  window.__bunmaska.invoke('add', 20, 22).then(function (r) {",
        "    window.__bunmaska.send('result', r);",
        '  });',
        '});',
      ].join('\n');

      const win = app.createWindow({
        width: 400,
        height: 300,
        title: 'ipc',
        show: true,
        preloadScript: preload,
      });
      const received: string[] = [];
      win.webContents.onRendererEnvelope(async (json) => {
        received.push(json);
        const env = decodeEnvelope(json);
        if (env.kind === 'send' || env.kind === 'invoke') {
          const reply = await ipc.dispatch(env, { sender: win.webContents });
          if (reply !== undefined) {
            win.webContents.sendEnvelopeToRenderer(encodeEnvelope(reply));
          }
        }
      });
      win.webContents.loadHTML('<html><body>ipc</body></html>', 'about:blank');

      const env = await driveUntilEnvelope(
        win,
        received,
        'go',
        (e) => e.kind === 'send' && e.channel === 'result',
      );
      expect(env).toMatchObject({ kind: 'send', channel: 'result', args: [42] });
    });
  });
}
