import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow } from '../../../src/main/platform/native';

/**
 * End-to-end proof that `webPreferences.preload` runs at document-start AFTER
 * the built-in bridge, in the ISOLATED world, on the Linux backend (real GTK4 +
 * WebKitGTK).
 *
 * The preload records whether the bridge existed when it ran and, on a 'go'
 * trigger dispatched into the isolated world, posts that back over IPC.
 *
 * Runs only in CI ubuntu under `xvfb-run -a` with the same GPU-less env as
 * `linux-backend.test.ts`. Inert on macOS via `describe.skipIf`.
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

describe.skipIf(!isLinux)('Linux webPreferences.preload end-to-end', () => {
  test('user preload runs at document-start with the bridge already installed', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), 'sambar-preload-e2e-'));
    // The preload (isolated world) records whether the bridge exists at the
    // instant it runs, and on 'go' posts its findings back.
    const preloadSource = [
      'window.__sambarPreloadRan = true;',
      'window.__sambarBridgeAtPreload = typeof window.__sambar !== "undefined";',
      "window.__sambar.on('go', function () {",
      "  window.__sambar.send('preload-check', window.__sambarPreloadRan === true, window.__sambarBridgeAtPreload === true);",
      '});',
    ].join('\n');
    writeFileSync(join(dir, 'preload.js'), preloadSource);

    const app = createLinuxApplication();
    app.start();

    const window: NativeWindow = app.createWindow({
      width: 320,
      height: 240,
      title: 'Linux Preload E2E',
      show: true,
      preloadScript: preloadSource,
    });
    const contents = window.webContents;

    let didFinish = false;
    contents.onNavigation((navEvent) => {
      if (navEvent.type !== 'did-finish-load') {
        return;
      }
      didFinish = true;
    });

    const received: string[] = [];
    contents.onRendererEnvelope((json) => {
      received.push(json);
    });

    contents.loadHTML('<!doctype html><html><body>preload</body></html>');
    await pumpUntil(() => didFinish, 5000);

    const find = (channel: string): string | undefined =>
      received.find((json) => {
        const env = JSON.parse(json) as { kind: string; channel?: string };
        return env.kind === 'send' && env.channel === channel;
      });

    await pumpUntil(() => {
      contents.sendEnvelopeToRenderer(JSON.stringify({ kind: 'send', channel: 'go', args: [] }));
      return find('preload-check') !== undefined;
    }, 5000);

    const inbound = find('preload-check');
    expect(inbound).toBeDefined();
    // args[0] = preload executed; args[1] = bridge was available when it ran.
    expect(JSON.parse(inbound ?? '{}')).toMatchObject({
      kind: 'send',
      channel: 'preload-check',
      args: [true, true],
    });

    window.close();
    await pump(100);
    rmSync(dir, { recursive: true, force: true });
    app.quit();
  });
});
