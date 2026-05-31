import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentPlatform } from '../../../src/common/platform';
import { decodeEnvelope } from '../../../src/main/ipc/ipc-protocol';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import type { NativeApplication, NativeWindow } from '../../../src/main/platform/native';

/**
 * End-to-end proof that `webPreferences.preload` runs at document-start AFTER
 * the built-in bridge, against a real WKWebView. The preload records whether
 * `window.__sambar` existed when it ran and posts that back over IPC — proving
 * bridge-before-preload ordering.
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('webPreferences.preload end-to-end over a real webview', () => {
    let app: NativeApplication;
    let win: NativeWindow;
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'sambar-preload-e2e-'));
      // The preload runs before page scripts; it captures whether the bridge
      // is present at that instant on a global so a later poll can post it back.
      const preloadSource = [
        'window.__sambarPreloadRan = true;',
        'window.__sambarBridgeAtPreload = typeof window.__sambar !== "undefined";',
      ].join('\n');
      const preloadPath = join(dir, 'preload.js');
      writeFileSync(preloadPath, preloadSource);

      app = createMacOSApplication();
      app.start();
      win = app.createWindow({
        width: 400,
        height: 300,
        title: 'preload',
        show: true,
        preloadScript: preloadSource,
      });
    });

    afterAll(() => {
      app.quit();
      rmSync(dir, { recursive: true, force: true });
    });

    /**
     * Re-run `injectJs` every poll until an envelope matching `predicate`
     * arrives, robust to load/preload timing on slow CI runners.
     */
    const driveUntilEnvelope = async (
      received: readonly string[],
      injectJs: string,
      predicate: (env: ReturnType<typeof decodeEnvelope>) => boolean,
      timeoutMs = 5000,
    ): Promise<ReturnType<typeof decodeEnvelope> | undefined> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        win.webContents.executeJavaScript(`if (window.__sambar) { ${injectJs} }`);
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

    test('user preload runs at document-start with the bridge already installed', async () => {
      const received: string[] = [];
      win.webContents.onRendererEnvelope((json) => received.push(json));
      win.webContents.loadHTML('<html><body>preload</body></html>', 'about:blank');

      const env = await driveUntilEnvelope(
        received,
        "window.__sambar.send('preload-check', window.__sambarPreloadRan === true, window.__sambarBridgeAtPreload === true);",
        (e) => e.kind === 'send' && e.channel === 'preload-check',
      );
      // args[0] = preload executed; args[1] = bridge was available when it ran.
      expect(env).toMatchObject({ kind: 'send', channel: 'preload-check', args: [true, true] });
    });
  });
}
