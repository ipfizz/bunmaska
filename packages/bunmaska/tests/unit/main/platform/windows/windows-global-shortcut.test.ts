import { describe, expect, test } from 'bun:test';
import { acceleratorToHotkey } from '../../../../../src/main/platform/windows/windows-global-shortcut';

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

  test('an unparseable accelerator yields undefined', () => {
    expect(acceleratorToHotkey('')).toBeUndefined();
    expect(acceleratorToHotkey('Ctrl')).toBeUndefined(); // modifier with no key
  });

  test('a key with no Windows virtual-key code yields undefined', () => {
    // '£' parses as a one-char key but has no VK mapping.
    expect(acceleratorToHotkey('CmdOrCtrl+£')).toBeUndefined();
  });
});
