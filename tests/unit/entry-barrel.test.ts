import { describe, expect, test } from 'bun:test';
import * as bunmaskaMain from '../../src/main';
import * as bunmaska from '../../src';

describe('bunmaska/main entry barrel', () => {
  test('exports the app singleton', () => {
    expect(bunmaskaMain.app).toBeDefined();
  });

  test('exports the App class', () => {
    expect(bunmaskaMain.App).toBeDefined();
    expect(bunmaskaMain.app).toBeInstanceOf(bunmaskaMain.App);
  });

  test('exports BunmaskaError', () => {
    expect(bunmaskaMain.BunmaskaError).toBeDefined();
    expect(new bunmaskaMain.BunmaskaError('x')).toBeInstanceOf(bunmaskaMain.BunmaskaError);
  });

  test('exports currentPlatform', () => {
    expect(typeof bunmaskaMain.currentPlatform).toBe('function');
  });

  test('exports the Notification class', () => {
    expect(bunmaskaMain.Notification).toBeDefined();
    expect(typeof bunmaskaMain.Notification.isSupported).toBe('function');
  });

  test('exports the screen module', () => {
    expect(bunmaskaMain.screen).toBeDefined();
    expect(typeof bunmaskaMain.screen.getAllDisplays).toBe('function');
    expect(typeof bunmaskaMain.screen.getPrimaryDisplay).toBe('function');
  });

  test('exports the Tray class', () => {
    expect(bunmaskaMain.Tray).toBeDefined();
    expect(typeof bunmaskaMain.Tray).toBe('function');
  });

  test('exports the protocol module', () => {
    expect(bunmaskaMain.protocol).toBeDefined();
    expect(typeof bunmaskaMain.protocol.handle).toBe('function');
    expect(typeof bunmaskaMain.protocol.isProtocolHandled).toBe('function');
    expect(typeof bunmaskaMain.protocol.getRegisteredSchemes).toBe('function');
  });

  test('exports the nativeImage module and class', () => {
    expect(bunmaskaMain.nativeImage).toBeDefined();
    expect(typeof bunmaskaMain.nativeImage.createFromPath).toBe('function');
    expect(typeof bunmaskaMain.nativeImage.createFromBuffer).toBe('function');
    expect(typeof bunmaskaMain.nativeImage.createEmpty).toBe('function');
    expect(typeof bunmaskaMain.NativeImage).toBe('function');
  });
});

describe('bunmaska (root) entry barrel', () => {
  test('re-exports the same app singleton as bunmaska/main', () => {
    expect(bunmaska.app).toBe(bunmaskaMain.app);
  });

  test('re-exports the App class', () => {
    expect(bunmaska.App).toBe(bunmaskaMain.App);
  });

  test('re-exports BunmaskaError', () => {
    expect(bunmaska.BunmaskaError).toBe(bunmaskaMain.BunmaskaError);
  });
});
