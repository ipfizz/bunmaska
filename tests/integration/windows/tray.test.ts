import { afterEach, describe, expect, test } from 'bun:test';
import { ptr } from 'bun:ffi';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentPlatform } from '../../../src/common/platform';
import { Tray } from '../../../src/main/api/tray';
import { wstr } from '../../../src/main/platform/windows/win32';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import { loadTrayIcon, windowsTrayBackend } from '../../../src/main/platform/windows/windows-tray';

/**
 * Windows tray against the real Shell_NotifyIcon API. A non-existent icon path is
 * used so the backend falls back to the default application icon (proving the
 * fallback) rather than needing a `.ico` fixture; the icon is added and removed
 * within each test. Click delivery is covered purely by `isTrayActivation`
 * (windows-tray.test.ts); here we exercise the real add/modify/delete lifecycle.
 * Runs only on a Windows host; inert elsewhere.
 */
const BAD_ICON = 'C:\\bunmaska_no_such_icon_zzz.ico';
/** A 1x1 PNG, the format `Tray` hands the backend for every NativeImage. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

if (currentPlatform() === 'windows') {
  describe('Windows tray backend', () => {
    test('create adds an icon (default-icon fallback) and destroy removes it', () => {
      const taskbarCreated = loadUser32().symbols.RegisterWindowMessageW(
        ptr(wstr('TaskbarCreated')),
      );
      expect(taskbarCreated).toBeGreaterThanOrEqual(0xc000); // registered ids live in 0xC000..0xFFFF
      const tray = windowsTrayBackend.create(BAD_ICON);
      expect(tray.isDestroyed()).toBe(false);
      tray.destroy();
      expect(tray.isDestroyed()).toBe(true);
    });

    test('a PNG loads as an owned icon; a missing file falls back to the shared default', () => {
      const dir = mkdtempSync(join(tmpdir(), 'bunmaska-tray-'));
      const path = join(dir, 'icon.png');
      writeFileSync(path, PNG_1x1);
      try {
        const icon = loadTrayIcon(path);
        expect(icon.owned).toBe(true);
        expect(icon.handle).not.toBe(0n);
        loadUser32().symbols.DestroyIcon(icon.handle);
        expect(loadTrayIcon(BAD_ICON).owned).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('destroy is idempotent', () => {
      const tray = windowsTrayBackend.create(BAD_ICON);
      tray.destroy();
      expect(() => tray.destroy()).not.toThrow();
      expect(tray.isDestroyed()).toBe(true);
    });

    test('setToolTip / setTitle / setImage / setContextMenu do not throw on a live tray', () => {
      const tray = windowsTrayBackend.create(BAD_ICON);
      try {
        expect(() => tray.setToolTip('Bunmaska')).not.toThrow();
        expect(() => tray.setTitle('ignored on windows')).not.toThrow();
        expect(() => tray.setImage(BAD_ICON)).not.toThrow();
        expect(() => tray.setContextMenu(null)).not.toThrow();
      } finally {
        tray.destroy();
      }
    });

    test('onClick stores the callback without firing it eagerly', () => {
      const tray = windowsTrayBackend.create(BAD_ICON);
      let clicks = 0;
      try {
        tray.onClick(() => {
          clicks += 1;
        });
        expect(clicks).toBe(0);
      } finally {
        tray.destroy();
      }
    });
  });

  describe('Windows Tray (public class over the real backend)', () => {
    let tray: Tray | undefined;

    afterEach(() => {
      tray?.destroy();
      tray = undefined;
    });

    test('constructs a real status item and tears it down', () => {
      tray = new Tray(BAD_ICON);
      expect(tray.isDestroyed()).toBe(false);
      tray.setToolTip('Bunmaska');
      tray.destroy();
      expect(tray.isDestroyed()).toBe(true);
    });
  });
}
