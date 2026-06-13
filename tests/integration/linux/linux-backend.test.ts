import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow } from '../../../src/main/platform/native';

/**
 * Full Linux backend lifecycle + IPC round-trip against real GTK4 + WebKitGTK.
 *
 * `__sambar` now lives in the ISOLATED `SambarPreload` world (context
 * isolation), so the renderer-side IPC logic ships as a PRELOAD (which runs in
 * that world); the inbound 'ping' is posted on a 'go' trigger dispatched into
 * the isolated world, and the echo round-trip is driven the same way.
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

    // Isolated-world preload: registers the echo listener and, on 'go', posts an
    // inbound 'ping'. The bridge is invisible to page scripts now.
    const preload = [
      "window.__sambar.on('echo', function (payload) {",
      "  window.__sambar.send('echoed', payload);",
      '});',
      "window.__sambar.on('go', function () {",
      "  window.__sambar.send('ping', { hello: 'world' });",
      '});',
    ].join('\n');

    const window: NativeWindow = app.createWindow({
      width: 320,
      height: 240,
      title: 'Linux E2E',
      show: true,
      preloadScript: preload,
    });
    const contents = window.webContents;

    // show() + present(), then pump so the window maps and gets an allocation.
    await pump(200);
    const bounds = window.getBounds();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);

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

    contents.loadHTML('<!doctype html><html><body>linux e2e</body></html>');

    await pumpUntil(() => didFinish, 5000);
    expect(didFinish).toBe(true);

    const find = (channel: string): string | undefined =>
      received.find((json) => {
        const env = JSON.parse(json) as { kind: string; channel?: string };
        return env.kind === 'send' && env.channel === channel;
      });

    // Trigger the inbound 'ping' by dispatching 'go' into the isolated world.
    await pumpUntil(() => {
      contents.sendEnvelopeToRenderer(JSON.stringify({ kind: 'send', channel: 'go', args: [] }));
      return find('ping') !== undefined;
    }, 5000);
    const inbound = find('ping');
    expect(inbound).toBeDefined();
    expect(inbound).toContain('ping');
    expect(JSON.parse(inbound ?? '{}')).toMatchObject({ kind: 'send', channel: 'ping' });

    // Round-trip: main -> renderer via _dispatch (isolated world) -> echo back.
    await pumpUntil(() => {
      contents.sendEnvelopeToRenderer(
        JSON.stringify({ kind: 'send', channel: 'echo', args: [{ pong: 1 }] }),
      );
      return find('echoed') !== undefined;
    }, 5000);
    const echoed = find('echoed');
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

  test('openDevTools exists and does not throw', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window: NativeWindow = app.createWindow({
      width: 320,
      height: 240,
      title: 'DevTools',
      show: true,
    });
    const contents = window.webContents;
    contents.loadHTML('<!doctype html><html><body>devtools</body></html>');
    await pump(200);
    expect(typeof contents.openDevTools).toBe('function');
    expect(() => contents.openDevTools()).not.toThrow();
    await pump(100);
    window.close();
    app.quit();
  });

  test('runtime setters (resizable/opacity/minSize/center) drive GTK without throwing', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window: NativeWindow = app.createWindow({
      width: 400,
      height: 300,
      title: 'Setters',
      show: true,
    });
    await pump(100);
    expect(() => {
      window.setResizable(false);
      window.setResizable(true);
      window.setOpacity(0.5);
      window.setOpacity(1);
      window.setMinimumSize(320, 240);
      window.center();
    }).not.toThrow();
    await pump(50);
    window.close();
    app.quit();
  });
});
