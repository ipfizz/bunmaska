import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow } from '../../../src/main/platform/native';

/**
 * End-to-end proof that `webPreferences.preload` runs at document-start AFTER
 * the built-in bridge on the Linux backend (real GTK4 + WebKitGTK).
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
    // The preload records whether the bridge exists at the instant it runs.
    const preloadSource = [
      'window.__sambarPreloadRan = true;',
      'window.__sambarBridgeAtPreload = typeof window.__sambar !== "undefined";',
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

    let received: string | undefined;
    contents.onRendererEnvelope((json) => {
      received = json;
    });

    // Page script (runs after preload) reports the preload's findings back.
    const html =
      '<!doctype html><html><body><script>' +
      "window.__sambar.send('preload-check'," +
      '  window.__sambarPreloadRan === true,' +
      '  window.__sambarBridgeAtPreload === true);' +
      '</script></body></html>';
    contents.loadHTML(html);

    await pumpUntil(() => received !== undefined, 5000);
    const inbound = received;
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
