import { describe, expect, test } from 'bun:test';
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
