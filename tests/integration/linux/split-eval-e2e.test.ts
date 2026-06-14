import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow } from '../../../src/main/platform/native';

/**
 * Linux split-eval proof on real GTK4 + WebKitGTK 6.0: the PUBLIC
 * `executeJavaScript` runs in the PAGE world (world_name = NULL), while internal
 * dispatch runs in the ISOLATED `BunmaskaPreload` world. They have separate
 * globals.
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

describe.skipIf(!isLinux)('Linux split eval semantics', () => {
  test('page-world global is invisible to the isolated world (and vice versa)', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }

    const isolatedPreload = [
      'window.__isoMarker = "from-isolated";',
      "window.__bunmaska.on('report', function () {",
      "  window.__bunmaska.send('report-result', window.__isoMarker, typeof window.__pageMarker);",
      '});',
    ].join('\n');

    const app = createLinuxApplication();
    app.start();

    const window: NativeWindow = app.createWindow({
      width: 320,
      height: 240,
      title: 'Linux Split Eval E2E',
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

    contents.loadHTML('<!doctype html><html><body>split</body></html>');
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

    await pumpUntil(() => {
      // Set a PAGE-world global via the public API (world_name = NULL).
      // Fire-and-forget: handle the teardown rejection so a late in-flight exec
      // cannot surface as an unhandled rejection.
      contents.executeJavaScript('window.__pageMarker = "from-page";').catch(() => undefined);
      // Ask the ISOLATED world to report.
      contents.sendEnvelopeToRenderer(
        JSON.stringify({ kind: 'send', channel: 'report', args: [] }),
      );
      return find('report-result') !== undefined;
    }, 6000);

    const report = find('report-result');
    expect(report).toBeDefined();
    expect(report?.args).toEqual(['from-isolated', 'undefined']);

    window.close();
    await pump(100);
    app.quit();
  });
});
