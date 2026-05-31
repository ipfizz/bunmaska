import { describe, expect, test } from 'bun:test';
import { parseAccelerator } from '../../../../../src/main/api/accelerator';
import {
  CONTROL_MASK,
  MOD1_MASK,
  MOD4_MASK,
  SHIFT_MASK,
  x11KeysymName,
  x11ModifierMask,
} from '../../../../../src/main/platform/linux/x11-keymap';
import { X11_FFI_SYMBOLS } from '../../../../../src/main/platform/linux/x11-ffi';

/**
 * Pure X11 keysym-name + modifier-mask mapping, plus an FFI SHAPE check for the
 * Xlib symbol table. No dlopen here (we are on macOS) — shape only.
 */

describe('x11KeysymName', () => {
  test('lowercases single ASCII letters', () => {
    expect(x11KeysymName('K')).toBe('k');
    expect(x11KeysymName('A')).toBe('a');
  });

  test('passes digits through unchanged', () => {
    expect(x11KeysymName('1')).toBe('1');
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

  test('returns undefined for an unmappable key', () => {
    expect(x11KeysymName('Plus')).toBe('plus');
    expect(x11KeysymName('Bogus')).toBeUndefined();
  });
});

describe('x11ModifierMask', () => {
  test('exposes the X.h mask constants', () => {
    expect(SHIFT_MASK).toBe(1);
    expect(CONTROL_MASK).toBe(4);
    expect(MOD1_MASK).toBe(8);
    expect(MOD4_MASK).toBe(64);
  });

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

describe('X11_FFI_SYMBOLS shape', () => {
  test('declares the grab/poll symbols the backend needs', () => {
    for (const name of [
      'XOpenDisplay',
      'XCloseDisplay',
      'XDefaultRootWindow',
      'XKeysymToKeycode',
      'XStringToKeysym',
      'XGrabKey',
      'XUngrabKey',
      'XSelectInput',
      'XPending',
      'XNextEvent',
      'XFlush',
    ]) {
      expect(X11_FFI_SYMBOLS).toHaveProperty(name);
    }
  });

  test('XGrabKey has the 7-argument Xlib signature', () => {
    expect(X11_FFI_SYMBOLS.XGrabKey.args).toHaveLength(7);
  });
});
