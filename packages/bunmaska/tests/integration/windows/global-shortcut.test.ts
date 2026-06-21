import { afterEach, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { globalShortcut } from '../../../src/main/api/global-shortcut';
import {
  createWindowsGlobalShortcutBackend,
  WM_HOTKEY,
} from '../../../src/main/platform/windows/windows-global-shortcut';

/**
 * Windows globalShortcut against the real RegisterHotKey API. The OS grab is
 * exercised for real (obscure combos avoid colliding with live system hot keys),
 * and delivery is driven by feeding a synthetic WM_HOTKEY through the same
 * `dispatchHotkeyMessage` hook the cooperative pump calls — so no actual key
 * press is needed. A fresh factory backend gives each test an isolated id space.
 * Runs only on a Windows host; inert elsewhere.
 */
if (currentPlatform() === 'windows') {
  describe('Windows globalShortcut backend', () => {
    test('isSupported is true', () => {
      expect(createWindowsGlobalShortcutBackend().isSupported()).toBe(true);
    });

    test('register grabs the hot key and WM_HOTKEY fires its callback', () => {
      const backend = createWindowsGlobalShortcutBackend();
      let fired = 0;
      // First registration in a fresh backend gets id 1.
      expect(backend.register('Ctrl+Alt+Shift+F24', () => fired++)).toBe(true);
      expect(backend.dispatchHotkeyMessage(WM_HOTKEY, 1n)).toBe(true);
      expect(fired).toBe(1);
      backend.unregisterAll();
    });

    test('dispatchHotkeyMessage ignores non-hotkey messages and unknown ids', () => {
      const backend = createWindowsGlobalShortcutBackend();
      backend.register('Ctrl+Alt+Shift+F23', () => undefined);
      expect(backend.dispatchHotkeyMessage(0x0100, 1n)).toBe(false); // WM_KEYDOWN, not WM_HOTKEY
      expect(backend.dispatchHotkeyMessage(WM_HOTKEY, 999n)).toBe(false); // no such id
      backend.unregisterAll();
    });

    test('register returns false for an unmappable accelerator (no OS grab)', () => {
      const backend = createWindowsGlobalShortcutBackend();
      expect(backend.register('Ctrl+£', () => undefined)).toBe(false);
      expect(backend.register('', () => undefined)).toBe(false);
    });

    test('unregister releases a specific grab; a second backend can then claim it', () => {
      const backend = createWindowsGlobalShortcutBackend();
      expect(backend.register('Ctrl+Alt+Shift+F22', () => undefined)).toBe(true);
      backend.unregister('Ctrl+Alt+Shift+F22');
      const other = createWindowsGlobalShortcutBackend();
      expect(other.register('Ctrl+Alt+Shift+F22', () => undefined)).toBe(true);
      other.unregisterAll();
    });
  });

  describe('Windows globalShortcut public API', () => {
    afterEach(() => {
      globalShortcut.unregisterAll();
    });

    test('register/isRegistered/unregister bookkeeping over the real backend', () => {
      expect(globalShortcut.register('Ctrl+Alt+Shift+F21', () => undefined)).toBe(true);
      expect(globalShortcut.isRegistered('Ctrl+Alt+Shift+F21')).toBe(true);
      // Re-registering the same accelerator is refused (Electron contract).
      expect(globalShortcut.register('Ctrl+Alt+Shift+F21', () => undefined)).toBe(false);
      globalShortcut.unregister('Ctrl+Alt+Shift+F21');
      expect(globalShortcut.isRegistered('Ctrl+Alt+Shift+F21')).toBe(false);
    });
  });
}
