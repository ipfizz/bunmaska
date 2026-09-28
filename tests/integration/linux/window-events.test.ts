import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow, WindowEventType } from '../../../src/main/platform/native';

/**
 * BrowserWindow lifecycle events + preventable close on REAL GTK4.
 *
 * CI-gated (Linux + Xvfb only); inert on macOS via `describe.skipIf`. Pumps the
 * cooperative GLib loop cooperatively, within the 30s test budget. Proves:
 *  - `resize` fires via notify::default-width/height when the window is resized,
 *  - a `close` veto keeps the window open (close-request returns TRUE),
 *  - a non-prevented close fires `closed` and runs the teardown (a pending
 *    executeJavaScript settles instead of crashing on a freed view).
 *
 * `focus`/`blur` (notify::is-active) and `maximize`/`unmaximize`
 * (notify::maximized) depend on the window manager under Xvfb, which does not
 * reliably grant focus or honor maximize; those edges are covered by the unit
 * suite's fake. `minimize`/`restore` are DEFERRED on Linux (no observable GTK4
 * minimized property).
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

describe.skipIf(!isLinux)('Linux window lifecycle events end-to-end', () => {
  test('resize event fires and preventable close vetoes then closes', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window: NativeWindow = app.createWindow({
      width: 320,
      height: 240,
      title: 'Linux Events',
      show: true,
    });

    const counts = new Map<WindowEventType, number>();
    const bump = (type: WindowEventType): void => {
      window.onWindowEvent(type, () => {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      });
    };
    bump('resize');
    bump('show');

    await pump(200);

    // Resize: changing the default size flips notify::default-width/height.
    window.setSize(500, 400);
    await pumpUntil(() => (counts.get('resize') ?? 0) > 0, 3000);
    expect(counts.get('resize') ?? 0).toBeGreaterThan(0);

    // Preventable close: veto keeps the window open.
    let prevent = true;
    window.onClose(() => prevent);
    let closed = 0;
    window.onClosed(() => {
      closed += 1;
    });

    window.close();
    await pump(100);
    expect(closed).toBe(0);

    // A pending exec before the real close should settle (not crash) when the
    // close-path teardown runs.
    const pending = window.webContents.executeJavaScript('1 + 1').catch(() => 'settled');

    prevent = false;
    window.close();
    await pumpUntil(() => closed > 0, 2000);
    expect(closed).toBe(1);
    // The pending exec SETTLES without crashing on a freed view — the point of
    // the close-path teardown. Depending on timing it is `undefined` (teardown
    // resolves in-flight execs to undefined), `2` (the result arrived first), or
    // `'settled'` (rejected + caught); any of these proves no use-after-free.
    const settled = await pending;
    expect(settled === undefined || settled === 2 || settled === 'settled').toBe(true);

    app.quit();
  });

  test('a throwing close listener still closes and tears the window down', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window = app.createWindow({
      width: 200,
      height: 120,
      title: 'Throwing Close',
      show: true,
    });
    let closed = 0;
    window.onClosed(() => {
      closed += 1;
    });
    window.onClose(() => {
      throw new Error('listener bug');
    });

    window.close();

    expect(closed).toBe(1);
    await expect(window.webContents.executeJavaScript('1')).rejects.toThrow('destroyed');
    app.quit();
  });

  test('getBounds of a hidden window reports the size last set', () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window = app.createWindow({ width: 800, height: 600, title: 'Hidden', show: false });

    window.setSize(1024, 768);

    expect(window.getBounds()).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
    window.close();
    app.quit();
  });

  test('calls after close never touch the freed window or view', () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window = app.createWindow({ width: 200, height: 120, title: 'After Close', show: true });
    window.webContents.loadHTML('<p>x</p>');
    window.close();

    window.setTitle('ignored');
    window.show();
    window.webContents.loadURL('about:blank');
    window.webContents.sendEnvelopeToRenderer('{"kind":"send","channel":"late","args":[]}');

    expect(window.isVisible()).toBe(false);
    expect(window.isFocused()).toBe(false);
    expect(window.getBounds()).toEqual({ x: 0, y: 0, width: 200, height: 120 });
    expect(window.webContents.getURL()).toBe('');
    expect(window.webContents.canGoBack()).toBe(false);
    app.quit();
  });

  test('a close listener that destroys the window does not destroy it twice', () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window = app.createWindow({
      width: 200,
      height: 120,
      title: 'Destroy In Close',
      show: true,
    });
    let closed = 0;
    window.onClosed(() => {
      closed += 1;
    });
    window.onClose(() => {
      window.destroy();
      return false;
    });

    window.close();

    expect(closed).toBe(1);
    app.quit();
  });
});
