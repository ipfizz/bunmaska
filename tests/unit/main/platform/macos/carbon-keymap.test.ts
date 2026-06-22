import { describe, expect, test } from 'bun:test';
import { parseAccelerator } from '../../../../../src/main/api/accelerator';
import {
  carbonModifierMask,
  CMD_KEY,
  CONTROL_KEY,
  macVirtualKeyCode,
  OPTION_KEY,
  SHIFT_KEY,
} from '../../../../../src/main/platform/macos/carbon-keymap';

/**
 * Pure key-code/modifier mapping for the macOS Carbon backend. No FFI here —
 * these tables translate a parsed accelerator into Carbon's virtual key code and
 * modifier mask, and are unit-tested directly.
 */

describe('macVirtualKeyCode', () => {
  test('maps the US-layout home-row anchors from the Carbon table', () => {
    expect(macVirtualKeyCode('A')).toBe(0);
    expect(macVirtualKeyCode('S')).toBe(1);
    expect(macVirtualKeyCode('D')).toBe(2);
    expect(macVirtualKeyCode('F')).toBe(3);
    expect(macVirtualKeyCode('H')).toBe(4);
    expect(macVirtualKeyCode('G')).toBe(5);
  });

  test('maps K (the Electron docs example key)', () => {
    expect(macVirtualKeyCode('K')).toBe(40);
  });

  test('maps digits', () => {
    expect(macVirtualKeyCode('1')).toBe(18);
    expect(macVirtualKeyCode('0')).toBe(29);
  });

  test('maps function keys', () => {
    expect(macVirtualKeyCode('F1')).toBe(122);
    expect(macVirtualKeyCode('F5')).toBe(96);
    expect(macVirtualKeyCode('F12')).toBe(111);
  });

  test('maps common named keys', () => {
    expect(macVirtualKeyCode('Space')).toBe(49);
    expect(macVirtualKeyCode('Return')).toBe(36);
    expect(macVirtualKeyCode('Escape')).toBe(53);
    expect(macVirtualKeyCode('Tab')).toBe(48);
  });

  test('returns undefined for an unmappable key', () => {
    expect(macVirtualKeyCode('Plus')).toBeUndefined();
  });

  test('is case-insensitive on the key label', () => {
    expect(macVirtualKeyCode('a')).toBe(0);
  });
});

describe('carbonModifierMask', () => {
  test('exposes the Carbon mask constants', () => {
    expect(CMD_KEY).toBe(0x100);
    expect(SHIFT_KEY).toBe(0x200);
    expect(OPTION_KEY).toBe(0x800);
    expect(CONTROL_KEY).toBe(0x1000);
  });

  test('Cmd accelerator on macOS yields the cmdKey mask', () => {
    const parsed = parseAccelerator('CmdOrCtrl+K', 'macos');
    expect(parsed).toBeDefined();
    if (parsed === undefined) {
      throw new Error('unreachable');
    }
    expect(carbonModifierMask(parsed)).toBe(CMD_KEY);
  });

  test('all modifiers OR together', () => {
    const parsed = parseAccelerator('Cmd+Ctrl+Alt+Shift+X', 'macos');
    if (parsed === undefined) {
      throw new Error('unreachable');
    }
    expect(carbonModifierMask(parsed)).toBe(CMD_KEY | CONTROL_KEY | OPTION_KEY | SHIFT_KEY);
  });

  test('a bare key yields a zero mask', () => {
    const parsed = parseAccelerator('K', 'macos');
    if (parsed === undefined) {
      throw new Error('unreachable');
    }
    expect(carbonModifierMask(parsed)).toBe(0);
  });
});
