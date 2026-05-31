import { describe, expect, test } from 'bun:test';
import * as sambarMain from '../../src/main';
import * as sambar from '../../src';

describe('sambar/main entry barrel', () => {
  test('exports the app singleton', () => {
    expect(sambarMain.app).toBeDefined();
  });

  test('exports the App class', () => {
    expect(sambarMain.App).toBeDefined();
    expect(sambarMain.app).toBeInstanceOf(sambarMain.App);
  });

  test('exports SambarError', () => {
    expect(sambarMain.SambarError).toBeDefined();
    expect(new sambarMain.SambarError('x')).toBeInstanceOf(sambarMain.SambarError);
  });

  test('exports currentPlatform', () => {
    expect(typeof sambarMain.currentPlatform).toBe('function');
  });

  test('exports the Notification class', () => {
    expect(sambarMain.Notification).toBeDefined();
    expect(typeof sambarMain.Notification.isSupported).toBe('function');
  });

  test('exports the screen module', () => {
    expect(sambarMain.screen).toBeDefined();
    expect(typeof sambarMain.screen.getAllDisplays).toBe('function');
    expect(typeof sambarMain.screen.getPrimaryDisplay).toBe('function');
  });
});

describe('sambar (root) entry barrel', () => {
  test('re-exports the same app singleton as sambar/main', () => {
    expect(sambar.app).toBe(sambarMain.app);
  });

  test('re-exports the App class', () => {
    expect(sambar.App).toBe(sambarMain.App);
  });

  test('re-exports SambarError', () => {
    expect(sambar.SambarError).toBe(sambarMain.SambarError);
  });
});
