import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';
import { nativeTheme, NativeThemeImpl } from '../../../../src/main/api/native-theme';

describe('nativeTheme', () => {
  test('exposes a boolean shouldUseDarkColors', () => {
    expect(typeof nativeTheme.shouldUseDarkColors).toBe('boolean');
  });

  test('is an EventEmitter for the updated event', () => {
    expect(nativeTheme).toBeInstanceOf(EventEmitter);
  });
});

describe('nativeTheme.themeSource', () => {
  test('defaults to system', () => {
    expect(new NativeThemeImpl().themeSource).toBe('system');
  });

  test('themeSource "dark" forces shouldUseDarkColors true', () => {
    const t = new NativeThemeImpl();
    t.themeSource = 'dark';
    expect(t.shouldUseDarkColors).toBe(true);
  });

  test('themeSource "light" forces shouldUseDarkColors false', () => {
    const t = new NativeThemeImpl();
    t.themeSource = 'light';
    expect(t.shouldUseDarkColors).toBe(false);
  });

  test('themeSource "system" reads the OS appearance (a boolean)', () => {
    const t = new NativeThemeImpl();
    t.themeSource = 'system';
    expect(typeof t.shouldUseDarkColors).toBe('boolean');
  });

  test('setting themeSource emits updated', () => {
    const t = new NativeThemeImpl();
    let fired = 0;
    t.on('updated', () => {
      fired += 1;
    });
    t.themeSource = 'dark';
    expect(fired).toBe(1);
  });
});
