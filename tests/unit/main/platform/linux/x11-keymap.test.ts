import { describe, expect, test } from 'bun:test';
import { parseAccelerator } from '../../../../../src/common/accelerator';
import {
  CONTROL_MASK,
  MOD1_MASK,
  MOD4_MASK,
  SHIFT_MASK,
  x11KeysymName,
  x11ModifierMask,
  x11StateMatches,
} from '../../../../../src/main/platform/linux/x11-keymap';

describe('x11KeysymName', () => {
  test('lowercases single ASCII letters', () => {
    expect(x11KeysymName('K')).toBe('k');
    expect(x11KeysymName('A')).toBe('a');
  });

  test('passes digits through unchanged', () => {
    expect(x11KeysymName('1')).toBe('1');
  });

  test('maps punctuation to the Unicode keysym form XStringToKeysym accepts', () => {
    expect(x11KeysymName(',')).toBe('U2c');
    expect(x11KeysymName('/')).toBe('U2f');
    expect(x11KeysymName('`')).toBe('U60');
  });

  test('maps function keys to their X names', () => {
    expect(x11KeysymName('F5')).toBe('F5');
  });

  test('maps named keys to X keysym strings', () => {
    expect(x11KeysymName('Space')).toBe('space');
    expect(x11KeysymName('Return')).toBe('Return');
    expect(x11KeysymName('PageUp')).toBe('Prior');
    expect(x11KeysymName('PageDown')).toBe('Next');
    expect(x11KeysymName('Backspace')).toBe('BackSpace');
  });

  test('maps the Plus key name to its keysym', () => {
    expect(x11KeysymName('Plus')).toBe('plus');
  });

  test('maps the numeric keypad and Insert to their own keysyms, not the top row', () => {
    const name = (accelerator: string): string | undefined => {
      const parsed = parseAccelerator(accelerator, 'linux');
      return parsed === undefined ? undefined : x11KeysymName(parsed.key);
    };
    expect(name('num0')).toBe('KP_0');
    expect(name('num9')).toBe('KP_9');
    expect(name('numdec')).toBe('KP_Decimal');
    expect(name('nummult')).toBe('KP_Multiply');
    expect(name('numadd')).toBe('KP_Add');
    expect(name('numdiv')).toBe('KP_Divide');
    expect(name('numsub')).toBe('KP_Subtract');
    expect(name('Insert')).toBe('Insert');
  });

  test('returns undefined for an unmappable key', () => {
    expect(x11KeysymName('Bogus')).toBeUndefined();
  });
});

describe('x11ModifierMask', () => {
  test('CmdOrCtrl on Linux yields ControlMask', () => {
    const parsed = parseAccelerator('CmdOrCtrl+K', 'linux');
    if (parsed === undefined) {
      throw new Error('unreachable');
    }
    expect(x11ModifierMask(parsed)).toBe(CONTROL_MASK);
  });

  test('Super yields Mod4Mask', () => {
    const parsed = parseAccelerator('Super+K', 'linux');
    if (parsed === undefined) {
      throw new Error('unreachable');
    }
    expect(x11ModifierMask(parsed)).toBe(MOD4_MASK);
  });

  test('all modifiers OR together', () => {
    const parsed = parseAccelerator('Ctrl+Alt+Shift+Super+X', 'linux');
    if (parsed === undefined) {
      throw new Error('unreachable');
    }
    expect(x11ModifierMask(parsed)).toBe(CONTROL_MASK | MOD1_MASK | SHIFT_MASK | MOD4_MASK);
  });
});

describe('x11StateMatches', () => {
  test('matches the exact registered modifiers', () => {
    expect(x11StateMatches(CONTROL_MASK | SHIFT_MASK, CONTROL_MASK | SHIFT_MASK)).toBe(true);
  });

  test('rejects a subset or superset of the registered modifiers', () => {
    expect(x11StateMatches(CONTROL_MASK, CONTROL_MASK | SHIFT_MASK)).toBe(false);
    expect(x11StateMatches(CONTROL_MASK | SHIFT_MASK, CONTROL_MASK)).toBe(false);
  });

  test('ignores CapsLock and NumLock state bits', () => {
    const lockAndNumLock = (1 << 1) | (1 << 4);
    expect(x11StateMatches(CONTROL_MASK | lockAndNumLock, CONTROL_MASK)).toBe(true);
  });

  test('ignores the XKB group bits of a second keyboard layout', () => {
    expect(x11StateMatches(CONTROL_MASK | (1 << 13), CONTROL_MASK)).toBe(true);
  });

  test('ignores a held pointer button', () => {
    expect(x11StateMatches(CONTROL_MASK | (1 << 8), CONTROL_MASK)).toBe(true);
  });
});
