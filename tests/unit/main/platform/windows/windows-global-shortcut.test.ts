import { describe, expect, test } from 'bun:test';
import {
  acceleratorToHotkey,
  createWindowsGlobalShortcutBackend,
  WM_HOTKEY,
} from '../../../../../src/main/platform/windows/windows-global-shortcut';
import type { MessageHandler } from '../../../../../src/main/platform/windows/windows-message-window';

/**
 * Pure accelerator → Windows hot key translation (virtual-key code + RegisterHotKey
 * `fsModifiers`). `MOD_NOREPEAT` (0x4000) is always set; on Windows `CmdOrCtrl`
 * resolves to Control and Super/Meta to the Windows key. Unmappable keys yield
 * `undefined` so `register` can return `false`.
 */
const MOD_ALT = 0x0001;
const MOD_CONTROL = 0x0002;
const MOD_SHIFT = 0x0004;
const MOD_WIN = 0x0008;
const MOD_NOREPEAT = 0x4000;

describe('acceleratorToHotkey', () => {
  test('CmdOrCtrl+A -> Ctrl + VK 0x41 (Control on Windows)', () => {
    expect(acceleratorToHotkey('CmdOrCtrl+A')).toEqual({
      vk: 0x41,
      modifiers: MOD_CONTROL | MOD_NOREPEAT,
    });
  });

  test('Ctrl+Shift+K combines modifiers', () => {
    expect(acceleratorToHotkey('Ctrl+Shift+K')).toEqual({
      vk: 0x4b,
      modifiers: MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
    });
  });

  test('Alt+F4 maps a function key (VK_F1 + 3)', () => {
    expect(acceleratorToHotkey('Alt+F4')).toEqual({ vk: 0x73, modifiers: MOD_ALT | MOD_NOREPEAT });
  });

  test('F13 maps beyond F12 (VK_F1 + 12)', () => {
    expect(acceleratorToHotkey('F13')).toEqual({ vk: 0x7c, modifiers: MOD_NOREPEAT });
  });

  test('Super+Space maps Super to the Windows key and a named key', () => {
    expect(acceleratorToHotkey('Super+Space')).toEqual({
      vk: 0x20,
      modifiers: MOD_WIN | MOD_NOREPEAT,
    });
  });

  test('a digit key maps to its character code', () => {
    expect(acceleratorToHotkey('CmdOrCtrl+1')).toEqual({
      vk: 0x31,
      modifiers: MOD_CONTROL | MOD_NOREPEAT,
    });
  });

  test('Plus maps to VK_OEM_PLUS', () => {
    expect(acceleratorToHotkey('CmdOrCtrl+Plus')?.vk).toBe(0xbb);
  });

  test('maps the numeric keypad and Insert to their own virtual keys, not the top row', () => {
    const vk = (key: string): number | undefined => acceleratorToHotkey(`CmdOrCtrl+${key}`)?.vk;
    expect(vk('num0')).toBe(0x60);
    expect(vk('num9')).toBe(0x69);
    expect(vk('nummult')).toBe(0x6a);
    expect(vk('numadd')).toBe(0x6b);
    // VK_SEPARATOR (0x6C) sits between numadd and numsub.
    expect(vk('numsub')).toBe(0x6d);
    expect(vk('numdec')).toBe(0x6e);
    expect(vk('numdiv')).toBe(0x6f);
    expect(vk('Insert')).toBe(0x2d);
  });

  test('an unparseable accelerator yields undefined', () => {
    expect(acceleratorToHotkey('')).toBeUndefined();
    expect(acceleratorToHotkey('Ctrl')).toBeUndefined(); // modifier with no key
  });

  test('a key with no Windows virtual-key code yields undefined', () => {
    // '£' parses as a one-char key but has no VK mapping.
    expect(acceleratorToHotkey('CmdOrCtrl+£')).toBeUndefined();
  });
});

describe('createWindowsGlobalShortcutBackend', () => {
  test('reuses a freed hot-key id, so a register/unregister cycle stays in the app id range', () => {
    const ids: number[] = [];
    const backend = createWindowsGlobalShortcutBackend(
      () => ({
        RegisterHotKey: (_hwnd: unknown, id: unknown) => ids.push(Number(id)),
        UnregisterHotKey: () => 1,
      }),
      () => ({ hwnd: 1n }),
    );
    for (let i = 0; i < 3; i += 1) {
      backend.register('Ctrl+Alt+K', () => undefined);
      backend.unregister('Ctrl+Alt+K');
    }
    expect(ids).toEqual([1, 1, 1]);
  });

  test('grabs hot keys for its own window, so a modal loop still delivers WM_HOTKEY', () => {
    const hwnds: unknown[] = [];
    let windowHandler: MessageHandler | undefined;
    const backend = createWindowsGlobalShortcutBackend(
      () => ({
        RegisterHotKey: (hwnd: unknown) => hwnds.push(hwnd),
        UnregisterHotKey: () => 1,
      }),
      (handler) => {
        windowHandler = handler;
        return { hwnd: 42n };
      },
    );
    let fired = 0;
    backend.register('Ctrl+Alt+K', () => {
      fired += 1;
    });
    windowHandler?.(WM_HOTKEY, 1n, 0n);
    expect(hwnds).toEqual([42n]);
    expect(fired).toBe(1);
  });
});
