import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow } from '../../../src/main/platform/native';

/**
 * Full Linux backend lifecycle + IPC round-trip against real GTK4 + WebKitGTK.
 *
 * Runs only in CI ubuntu under `xvfb-run -a` with
 * `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `LIBGL_ALWAYS_SOFTWARE=1`,
 * `GDK_BACKEND=x11` (headless GPU-less runners otherwise hit DMABUF/GBM
 * failures). Inert on macOS via `describe.skipIf`.
 */

const isLinux = process.platform === 'linux';

/** Pump the run loop cooperatively for `ms` while yielding to Bun's loop. */
const pump = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** Pump until `predicate()` is true or the budget elapses. */
const pumpUntil = async (predicate: () => boolean, budgetMs: number): Promise<void> => {
  const step = 20;
  for (let waited = 0; waited < budgetMs && !predicate(); waited += step) {
    await pump(step);
  }
};

describe.skipIf(!isLinux)('Linux backend end-to-end', () => {
  test('init + window + webview lifecycle and IPC round-trip', async () => {
    // gtk_init_check must succeed under Xvfb; if not, there is no display and
    // the rest cannot run — skip rather than fail.
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }

    const app = createLinuxApplication();
    app.start();

    const window: NativeWindow = app.createWindow({
      width: 320,
      height: 240,
      title: 'Linux E2E',
      show: true,
    });
    const contents = window.webContents;

    // show() + present(), then pump so the window maps and gets an allocation.
    await pump(200);
    const bounds = window.getBounds();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);

    let didFinish = false;
    contents.onDidFinishLoad(() => {
      didFinish = true;
    });

    let received: string | undefined;
    contents.onRendererEnvelope((json) => {
      received = json;
    });

    // The page posts an inbound envelope, then echoes anything main dispatches.
    const html =
      '<!doctype html><html><body><script>' +
      "window.__sambar.on('echo', function (payload) {" +
      "  window.__sambar.send('echoed', payload);" +
      '});' +
      "window.__sambar.send('ping', { hello: 'world' });" +
      '</script></body></html>';
    contents.loadHTML(html);

    await pumpUntil(() => didFinish, 5000);
    expect(didFinish).toBe(true);

    await pumpUntil(() => received !== undefined, 5000);
    const inbound = received;
    expect(inbound).toBeDefined();
    expect(inbound).toContain('ping');
    expect(JSON.parse(inbound ?? '{}')).toMatchObject({ kind: 'send', channel: 'ping' });

    // Round-trip: main -> renderer via _dispatch -> renderer echoes back.
    received = undefined;
    contents.sendEnvelopeToRenderer(
      JSON.stringify({ kind: 'send', channel: 'echo', args: [{ pong: 1 }] }),
    );
    await pumpUntil(() => received !== undefined, 5000);
    const echoed = received;
    expect(echoed).toBeDefined();
    expect(JSON.parse(echoed ?? '{}')).toMatchObject({ kind: 'send', channel: 'echoed' });

    // close() fires onClosed bookkeeping.
    let closed = false;
    window.onClosed(() => {
      closed = true;
    });
    window.close();
    await pump(100);
    expect(closed).toBe(true);

    app.quit();
  });
});
