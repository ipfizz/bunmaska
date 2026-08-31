import { describe, expect, test } from 'bun:test';
import * as electronShim from '../../src/electron';
import { createElectronShim } from '../../src/electron';
import { notImplementedMessage } from '../../src/main/module-list';

describe('createElectronShim', () => {
  test('returns implemented modules from the base surface', () => {
    const shim = createElectronShim({ app: 'APP', BrowserWindow: 'BW' });
    expect(shim['app']).toBe('APP');
    expect(shim['BrowserWindow']).toBe('BW');
  });

  test('throws an actionable error for a known-but-unimplemented module', () => {
    const shim = createElectronShim({});
    expect(() => shim['crashReporter']).toThrow(notImplementedMessage('crashReporter'));
    expect(() => shim['pushNotifications']).toThrow(notImplementedMessage('pushNotifications'));
  });

  test('returns undefined for an unknown name (like a plain object)', () => {
    const shim = createElectronShim({});
    expect(shim['totallyMadeUp']).toBeUndefined();
  });

  test('does not throw for an implemented module that exists on the base', () => {
    const shim = createElectronShim({ clipboard: 'CB' });
    expect(() => shim['clipboard']).not.toThrow();
    expect(shim['clipboard']).toBe('CB');
  });
});

describe('bunmaska/electron named exports', () => {
  test('exposes the modules the migration guide tells people to import', () => {
    // `import { app, BrowserWindow } from 'bunmaska/electron'` is the documented
    // drop-in path; it used to throw because only a default export existed.
    expect(electronShim.app).toBeDefined();
    expect(typeof electronShim.BrowserWindow).toBe('function');
    expect(typeof electronShim.ipcMain).toBe('object');
  });

  test('still ships the Proxy default whose property access is actionable', () => {
    const surface = electronShim.default as Record<string, unknown>;
    expect(surface['app']).toBe(electronShim.app);
    expect(() => surface['netLog']).toThrow(/not yet implemented/);
  });
});
