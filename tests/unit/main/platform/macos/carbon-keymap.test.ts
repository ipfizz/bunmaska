import { describe, expect, test } from 'bun:test';
import { parseAccelerator } from '../../../../../src/common/accelerator';
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

  test('maps function keys through F20', () => {
    expect(macVirtualKeyCode('F1')).toBe(122);
    expect(macVirtualKeyCode('F5')).toBe(96);
    expect(macVirtualKeyCode('F12')).toBe(111);
    expect(macVirtualKeyCode('F16')).toBe(106);
    expect(macVirtualKeyCode('F20')).toBe(90);
  });

  test('maps Plus to the =/+ key', () => {
    expect(macVirtualKeyCode('Plus')).toBe(macVirtualKeyCode('='));
  });

  test('maps common named keys', () => {
    expect(macVirtualKeyCode('Space')).toBe(49);
    expect(macVirtualKeyCode('Return')).toBe(36);
    expect(macVirtualKeyCode('Escape')).toBe(53);
    expect(macVirtualKeyCode('Tab')).toBe(48);
  });

  test('maps the numeric keypad and Insert the accelerator parser accepts', () => {
    const code = (accelerator: string): number | undefined => {
      const parsed = parseAccelerator(accelerator, 'macos');
      return parsed === undefined ? undefined : macVirtualKeyCode(parsed.key);
    };
    expect(code('num0')).toBe(82);
    expect(code('num7')).toBe(89);
    // kVK_ANSI_Keypad8 and 9 skip 0x5A, which is kVK_F20.
    expect(code('num8')).toBe(91);
    expect(code('num9')).toBe(92);
    expect(code('numdec')).toBe(65);
    expect(code('nummult')).toBe(67);
    expect(code('numadd')).toBe(69);
    expect(code('numdiv')).toBe(75);
    expect(code('numsub')).toBe(78);
    // A PC keyboard's Insert key reaches macOS as kVK_Help.
    expect(code('Insert')).toBe(114);
  });

  test('returns undefined for a key macOS has no code for', () => {
    expect(macVirtualKeyCode('F21')).toBeUndefined();
  });

  test('is case-insensitive on the key label', () => {
    expect(macVirtualKeyCode('a')).toBe(0);
  });
});

describe('carbonModifierMask', () => {
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

  test('Plus implies Shift, as Electron registers it', () => {
    const parsed = parseAccelerator('CmdOrCtrl+Plus', 'macos');
    if (parsed === undefined) {
      throw new Error('unreachable');
    }
    expect(carbonModifierMask(parsed)).toBe(CMD_KEY | SHIFT_KEY);
  });

  test('a bare key yields a zero mask', () => {
    const parsed = parseAccelerator('K', 'macos');
    if (parsed === undefined) {
      throw new Error('unreachable');
    }
    expect(carbonModifierMask(parsed)).toBe(0);
  });
});

test('Super maps to Cmd on macOS, matching Electron', () => {
  const superK = parseAccelerator('Super+K', 'macos');
  const cmdK = parseAccelerator('Cmd+K', 'macos');
  if (superK === undefined || cmdK === undefined) {
    throw new Error('both accelerators must parse');
  }
  // Without this, Super+K registered a bare-K global grab.
  expect(carbonModifierMask(superK)).toBe(carbonModifierMask(cmdK));
  expect(carbonModifierMask(superK)).not.toBe(0);
});
