import { describe, expect, test } from 'bun:test';
import type { Platform } from '../../../../src/common/platform';
import { parseAccelerator } from '../../../../src/main/api/accelerator';

/**
 * Pure, platform-parameterised accelerator parsing. No FFI: we pass the target
 * platform explicitly so the `CmdOrCtrl` resolution is testable on any host.
 */

const onMac = (accelerator: string) => parseAccelerator(accelerator, 'macos' satisfies Platform);
const onLinux = (accelerator: string) => parseAccelerator(accelerator, 'linux' satisfies Platform);

describe('parseAccelerator', () => {
  test('parses a bare single key', () => {
    expect(onMac('K')).toEqual({
      key: 'K',
      cmdOrCtrl: false,
      shift: false,
      alt: false,
      ctrl: false,
      meta: false,
      super: false,
    });
  });

  test('uppercases the final key for a lowercase accelerator', () => {
    expect(onMac('k')?.key).toBe('K');
  });

  test('CmdOrCtrl resolves to Cmd (meta) on macOS', () => {
    const parsed = onMac('CmdOrCtrl+K');
    expect(parsed?.cmdOrCtrl).toBe(true);
    expect(parsed?.meta).toBe(true);
    expect(parsed?.ctrl).toBe(false);
  });

  test('CmdOrCtrl resolves to Ctrl on Linux', () => {
    const parsed = onLinux('CmdOrCtrl+K');
    expect(parsed?.cmdOrCtrl).toBe(true);
    expect(parsed?.ctrl).toBe(true);
    expect(parsed?.meta).toBe(false);
  });

  test('Command and Cmd map to meta', () => {
    expect(onMac('Command+A')?.meta).toBe(true);
    expect(onMac('Cmd+A')?.meta).toBe(true);
  });

  test('Control and Ctrl map to ctrl', () => {
    expect(onMac('Control+A')?.ctrl).toBe(true);
    expect(onMac('Ctrl+A')?.ctrl).toBe(true);
  });

  test('Alt and Option map to alt', () => {
    expect(onMac('Alt+A')?.alt).toBe(true);
    expect(onMac('Option+A')?.alt).toBe(true);
  });

  test('Super and Meta map to super', () => {
    expect(onMac('Super+A')?.super).toBe(true);
    expect(onMac('Meta+A')?.super).toBe(true);
  });

  test('parses every modifier together', () => {
    const parsed = onMac('Cmd+Ctrl+Alt+Shift+Super+X');
    expect(parsed).toEqual({
      key: 'X',
      cmdOrCtrl: false,
      shift: true,
      alt: true,
      ctrl: true,
      meta: true,
      super: true,
    });
  });

  test('is case-insensitive for modifier names', () => {
    expect(onMac('cmdorctrl+shift+k')).toEqual(onMac('CmdOrCtrl+Shift+K'));
  });

  test('parses function keys', () => {
    expect(onMac('F5')?.key).toBe('F5');
    expect(onMac('CmdOrCtrl+F12')?.key).toBe('F12');
  });

  test('parses digit keys', () => {
    expect(onMac('CmdOrCtrl+1')?.key).toBe('1');
  });

  test('parses named keys', () => {
    expect(onMac('Space')?.key).toBe('Space');
    expect(onMac('CmdOrCtrl+Return')?.key).toBe('Return');
  });

  test('returns undefined for an empty string', () => {
    expect(onMac('')).toBeUndefined();
  });

  test('returns undefined for modifiers with no key', () => {
    expect(onMac('CmdOrCtrl+Shift')).toBeUndefined();
  });

  test('returns undefined for an unknown token', () => {
    expect(onMac('CmdOrCtrl+Boguskey')).toBeUndefined();
  });

  test('returns undefined for a duplicated final key (two keys)', () => {
    expect(onMac('A+B')).toBeUndefined();
  });

  test('trims surrounding whitespace in tokens', () => {
    expect(onMac(' CmdOrCtrl + K ')?.key).toBe('K');
  });
});
