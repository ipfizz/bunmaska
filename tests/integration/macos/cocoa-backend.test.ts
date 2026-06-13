import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
        const win = app.createWindow({ width: 480, height: 320, title: 'Sambar Test', show: true });
        expect(win.isVisible()).toBe(true);
        expect(win.getTitle()).toBe('Sambar Test');
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
        win.webContents.loadHTML('<html><body><h1>Sambar</h1></body></html>', 'about:blank');
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
