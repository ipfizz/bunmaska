import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { BrowserWindow } from '../../../src/main/api/browser-window';
import { resetBootstrapForTesting } from '../../../src/main/bootstrap';
import { nativeApp, setNativeAppForTesting } from '../../../src/main/native-app';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

if (currentPlatform() === 'macos') {
  describe('BrowserWindow on the real macOS backend', () => {
    beforeAll(() => {
      // Ensure the real native backend is used (other suites may have injected a fake).
      setNativeAppForTesting(undefined);
      resetBootstrapForTesting();
    });

    afterAll(() => {
      nativeApp().quit();
    });

    test('new BrowserWindow opens a visible native window', () => {
      const win = new BrowserWindow({ width: 520, height: 380, title: 'Integration', show: true });
      try {
        expect(win.isVisible()).toBe(true);
        expect(win.getTitle()).toBe('Integration');
        expect(win.getBounds().width).toBe(520);
      } finally {
        win.close();
      }
    });

    test('loadURL drives webContents.getURL after the run loop pumps', async () => {
      const win = new BrowserWindow({ width: 400, height: 300, title: 'Load', show: true });
      try {
        win.loadURL('about:blank');
        await delay(250);
        expect(win.webContents.getURL()).toBe('about:blank');
      } finally {
        win.close();
      }
    });

    test('the window is registered and discoverable via fromId', () => {
      const win = new BrowserWindow({ show: false });
      try {
        expect(BrowserWindow.fromId(win.id)).toBe(win);
      } finally {
        win.close();
      }
      expect(BrowserWindow.fromId(win.id)).toBeUndefined();
    });
  });
}
