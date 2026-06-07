import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow } from '../../../src/main/platform/native';

/**
 * Linux isolation proof on real GTK4 + WebKitGTK 6.0. Closes the
 * UNVERIFIED-IN-DOCS gap: that a non-NULL `world_name` passed from the UI
 * process targets a named isolated world without a web-process extension.
 *
 * The `__sambar` bridge + user preload run in the `SambarPreload` world; the
 * page world cannot see them. The isolated-world preload reports
 * `typeof window.__sambar` (object) and relays the page world's DOM probe
 * (undefined) back over IPC.
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

describe.skipIf(!isLinux)('Linux context isolation end-to-end', () => {
  test('isolated world sees __sambar as object; page world sees undefined', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }

    // The isolated-world preload sees __sambar and relays the page world's DOM
    // probe back over IPC. The page world shares the DOM but not the bridge.
    const isolatedPreload = [
      "window.__sambar.on('iso-typeof-req', function () {",
      "  window.__sambar.send('iso-typeof', typeof window.__sambar);",
      '});',
      "document.addEventListener('sambar-page-typeof', function (e) {",
      "  window.__sambar.send('page-typeof', e.detail);",
      '});',
    ].join('\n');

    const app = createLinuxApplication();
    app.start();

    const window: NativeWindow = app.createWindow({
      width: 320,
      height: 240,
      title: 'Linux Isolation E2E',
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

    // The page (main world) probes typeof __sambar and dispatches it on the DOM;
    // the isolated preload relays it. typeof of an undeclared global is safe.
    const html =
      '<!doctype html><html><body><script>' +
      "document.dispatchEvent(new CustomEvent('sambar-page-typeof', { detail: typeof window.__sambar }));" +
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

    // Ask the isolated world to report its view; poll for both answers.
    await pumpUntil(() => {
      contents.sendEnvelopeToRenderer(
        JSON.stringify({ kind: 'send', channel: 'iso-typeof-req', args: [] }),
      );
      return find('iso-typeof') !== undefined && find('page-typeof') !== undefined;
    }, 6000);

    const iso = find('iso-typeof');
    const page = find('page-typeof');
    expect(iso).toBeDefined();
    expect(iso?.args).toEqual(['object']);
    expect(page).toBeDefined();
    expect(page?.args).toEqual(['undefined']);

    window.close();
    await pump(100);
    app.quit();
  });
});
