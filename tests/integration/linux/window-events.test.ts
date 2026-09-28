import { describe, expect, test } from 'bun:test';
import { requireGtkDisplay } from '../../helpers/require-gtk-display';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeWindow, WindowEventType } from '../../../src/main/platform/native';

// Real GTK 4 under Xvfb, which has no window manager to grant focus or honour maximize.
// Every close here is programmatic; the title-bar close-request path is not driven (ponytail:
// needs gtk_window_close in gtk-ffi plus a way to reach the GtkWindow).

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
    requireGtkDisplay();
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
    expect(closed).toBe(0);

    // No await before close(), so the result cannot arrive first: teardown settles it.
    const pending = window.webContents.executeJavaScript('1 + 1');
    prevent = false;
    window.close();

    expect(closed).toBe(1);
    expect(await pending).toBeUndefined();

    app.quit();
  });

  test('a throwing close listener still closes and tears the window down', async () => {
    requireGtkDisplay();
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
    requireGtkDisplay();
    const app = createLinuxApplication();
    app.start();
    const window = app.createWindow({ width: 800, height: 600, title: 'Hidden', show: false });

    window.setSize(1024, 768);

    expect(window.getBounds()).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
    window.close();
    app.quit();
  });

  test('calls after close never touch the freed window or view', () => {
    requireGtkDisplay();
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
    requireGtkDisplay();
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
