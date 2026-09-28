import { describe, expect, jest, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import { retainedBlockCount } from '../../../src/main/platform/macos/cocoa-block';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, ms = 3_000): Promise<void> => {
  const deadline = performance.now() + ms;
  while (!predicate() && performance.now() < deadline) {
    await Bun.sleep(20);
  }
};

if (currentPlatform() === 'macos') {
  describe('MacOSApplication', () => {
    test('onReady fires synchronously once started', () => {
      const app = createMacOSApplication();
      let ready = false;
      app.onReady(() => {
        ready = true;
      });
      app.start();
      try {
        expect(ready).toBe(true);
      } finally {
        app.quit();
      }
    });

    test('start is idempotent', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        expect(() => app.start()).not.toThrow();
      } finally {
        app.quit();
      }
    });
  });

  describe('MacOSWindow + WebContents end-to-end', () => {
    test('creates a visible window with the requested title and bounds', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({
          width: 480,
          height: 320,
          title: 'Bunmaska Test',
          show: true,
        });
        expect(win.isVisible()).toBe(true);
        expect(win.getTitle()).toBe('Bunmaska Test');
        expect(win.getBounds().width).toBe(480);
      } finally {
        app.quit();
      }
    });

    test('setSize updates the reported bounds', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: false });
        win.setSize(640, 480);
        expect(win.getBounds()).toEqual({ x: 0, y: 0, width: 640, height: 480 });
      } finally {
        app.quit();
      }
    });

    test('runtime setters (resizable/opacity/minSize/center) drive AppKit without throwing', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: false });
        expect(() => {
          win.setResizable(false);
          win.setResizable(true);
          win.setOpacity(0.5);
          win.setOpacity(1);
          win.setMinimumSize(320, 240);
          win.center();
        }).not.toThrow();
      } finally {
        app.quit();
      }
    });

    test('loadHTML drives the webview URL to the base URL after pumping', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        win.webContents.loadHTML('<html><body><h1>Bunmaska</h1></body></html>', 'about:blank');
        await delay(250);
        expect(win.webContents.getURL()).toBe('about:blank');
      } finally {
        app.quit();
      }
    });

    test('executeJavaScript resolves to the script completion value', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        win.webContents.loadHTML('<html><body>hi</body></html>', 'about:blank');
        await delay(250);
        const result = await win.webContents.executeJavaScript('2 + 3');
        expect(result).toBe(5);
      } finally {
        app.quit();
      }
    });

    test('printToPDF renders the page to real PDF bytes via a block completion handler', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        win.webContents.loadHTML('<html><body><h1>Bunmaska PDF</h1></body></html>', 'about:blank');
        await delay(250);
        const pdf = await win.webContents.printToPDF();
        expect(pdf.length).toBeGreaterThan(100);
        // The PDF file magic is the ASCII bytes "%PDF".
        expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe('%PDF');
      } finally {
        app.quit();
      }
    });

    test('capturePage snapshots the page to PNG bytes via a block completion handler', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 320, height: 240, title: 't', show: true });
        win.webContents.loadHTML(
          '<html><body style="background:#08f">x</body></html>',
          'about:blank',
        );
        await delay(300);
        const png = await win.webContents.capturePage();
        expect(png.length).toBeGreaterThan(8);
        // PNG file magic: \x89 P N G.
        expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      } finally {
        app.quit();
      }
    });

    test('a timed-out render keeps its completion block alive until WebKit calls it', async () => {
      const app = createMacOSApplication();
      app.start();
      const win = app.createWindow({ width: 320, height: 240, title: 't', show: true });
      win.webContents.loadHTML('<p>render</p>', 'about:blank');
      await waitFor(() => win.webContents.getURL() === 'about:blank');
      // Let earlier tests' fired blocks finish their deferred cleanup before counting.
      await delay(50);
      // No pump while timers are faked, so WebKit cannot complete the render first.
      app.quit();
      const pump = createMacOSApplication();
      const baseline = retainedBlockCount();
      jest.useFakeTimers();
      try {
        const pdf = win.webContents.printToPDF();
        const png = win.webContents.capturePage();
        jest.advanceTimersByTime(30_001);
        await expect(pdf).rejects.toThrow(/timed out/);
        await expect(png).rejects.toThrow(/timed out/);
        jest.advanceTimersByTime(10);
        expect(retainedBlockCount()).toBe(baseline + 2);
      } finally {
        jest.useRealTimers();
      }
      pump.start();
      try {
        win.destroy();
        await waitFor(() => retainedBlockCount() === baseline);
        expect(retainedBlockCount()).toBe(baseline);
      } finally {
        pump.quit();
      }
    });

    test('openDevTools exists and does not throw', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        win.webContents.loadHTML('<html><body>hi</body></html>', 'about:blank');
        await delay(150);
        expect(typeof win.webContents.openDevTools).toBe('function');
        expect(() => win.webContents.openDevTools()).not.toThrow();
        await delay(50);
      } finally {
        app.quit();
      }
    });

    test('hide makes the window not visible', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: true });
        expect(win.isVisible()).toBe(true);
        win.hide();
        expect(win.isVisible()).toBe(false);
      } finally {
        app.quit();
      }
    });

    test('every window and contents call after close is a safe no-op', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 320, height: 240, title: 'closing', show: true });
        win.webContents.loadHTML('<p>x</p>', 'about:blank');
        await waitFor(() => win.webContents.getURL() === 'about:blank');
        const events: string[] = [];
        for (const type of ['show', 'hide', 'blur', 'focus', 'resize'] as const) {
          win.onWindowEvent(type, () => events.push(type));
        }
        win.close();
        const callEverything = (): void => {
          win.show();
          win.hide();
          win.focus();
          win.setTitle('after');
          win.setBounds({ x: 10, y: 10, width: 200, height: 100 });
          win.setSize(300, 200);
          win.setPosition(5, 5);
          win.setResizable(false);
          win.setOpacity(0.5);
          win.setMinimumSize(100, 100);
          win.center();
          win.minimize();
          win.restore();
          win.maximize();
          win.unmaximize();
          win.setFullScreen(true);
          win.setAlwaysOnTop(true);
          win.close();
          win.destroy();
          const contents = win.webContents;
          contents.loadURL('about:blank');
          contents.loadHTML('<p>y</p>');
          contents.reload();
          contents.reloadIgnoringCache();
          contents.stop();
          contents.goBack();
          contents.goForward();
          contents.setZoomFactor(2);
          contents.setUserAgent('ua');
          contents.openDevTools();
          contents.closeDevTools();
          contents.sendEnvelopeToRenderer('{}');
          expect(win.getTitle()).toBe('');
          expect(win.isVisible()).toBe(false);
          expect(win.isFocused()).toBe(false);
          expect(win.isMaximized()).toBe(false);
          expect(win.isMinimized()).toBe(false);
          expect(win.isFullScreen()).toBe(false);
          expect(contents.getURL()).toBe('');
          expect(contents.getTitle()).toBe('');
          expect(contents.canGoBack()).toBe(false);
          expect(contents.canGoForward()).toBe(false);
        };
        callEverything();
        // The native objects are released on a later tick; call again once they are gone.
        await Bun.sleep(100);
        callEverything();
        expect(events).toEqual([]);
      } finally {
        app.quit();
      }
    });

    test('close fires the onClosed callback once', () => {
      const app = createMacOSApplication();
      app.start();
      try {
        const win = app.createWindow({ width: 400, height: 300, title: 't', show: false });
        let closes = 0;
        win.onClosed(() => {
          closes += 1;
        });
        win.close();
        win.close();
        expect(closes).toBe(1);
      } finally {
        app.quit();
      }
    });
  });
}
