import { afterEach, describe, expect, test } from 'bun:test';
import {
  type GlobalShortcutBackend,
  globalShortcut,
  setGlobalShortcutBackendForTesting,
} from '../../../../src/main/api/global-shortcut';

/**
 * The platform-neutral `globalShortcut` API, exercised with a fake backend so
 * the accelerator validation, registry bookkeeping, and dispatch logic are
 * tested with ZERO FFI.
 */

type Registration = { accelerator: string; callback: () => void };

const makeFakeBackend = () => {
  const registered = new Map<string, () => void>();
  const calls: string[] = [];
  const backend: GlobalShortcutBackend = {
    isSupported: () => true,
    register: (accelerator, callback) => {
      calls.push(`register:${accelerator}`);
      registered.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => {
      calls.push(`unregister:${accelerator}`);
      registered.delete(accelerator);
    },
    unregisterAll: () => {
      calls.push('unregisterAll');
      registered.clear();
    },
  };
  const fire = (accelerator: string): void => {
    registered.get(accelerator)?.();
  };
  const has = (accelerator: string): boolean => registered.has(accelerator);
  const last = (): Registration | undefined => {
    const keys = [...registered.keys()];
    const k = keys[keys.length - 1];
    if (k === undefined) {
      return undefined;
    }
    return { accelerator: k, callback: registered.get(k) ?? (() => undefined) };
  };
  return { backend, fire, has, last, calls };
};

afterEach(() => {
  globalShortcut.unregisterAll();
  setGlobalShortcutBackendForTesting(undefined);
});

describe('globalShortcut.register', () => {
  test('parses, registers via the backend, and returns true', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    const ok = globalShortcut.register('CmdOrCtrl+Shift+K', () => undefined);
    expect(ok).toBe(true);
    expect(globalShortcut.isRegistered('CmdOrCtrl+Shift+K')).toBe(true);
    expect(fake.has('CmdOrCtrl+Shift+K')).toBe(true);
  });

  test('returns false and does NOT touch the backend for an unparseable accelerator', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    const ok = globalShortcut.register('CmdOrCtrl+Boguskey', () => undefined);
    expect(ok).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(globalShortcut.isRegistered('CmdOrCtrl+Boguskey')).toBe(false);
  });

  test('the registered callback fires when the backend dispatches it', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    let fired = 0;
    globalShortcut.register('CmdOrCtrl+J', () => {
      fired += 1;
    });
    fake.fire('CmdOrCtrl+J');
    expect(fired).toBe(1);
  });

  test('returns false if the backend itself rejects the registration', () => {
    const fake = makeFakeBackend();
    fake.backend.register = () => false;
    setGlobalShortcutBackendForTesting(fake.backend);
    expect(globalShortcut.register('CmdOrCtrl+K', () => undefined)).toBe(false);
    expect(globalShortcut.isRegistered('CmdOrCtrl+K')).toBe(false);
  });

  test('returns false when re-registering an already-registered accelerator (Electron contract)', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    expect(globalShortcut.register('CmdOrCtrl+K', () => undefined)).toBe(true);
    expect(globalShortcut.register('CmdOrCtrl+K', () => undefined)).toBe(false);
  });
});

describe('globalShortcut.registerAll', () => {
  test('registers every accelerator with the one shared callback', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    let fired = 0;
    globalShortcut.registerAll(['CmdOrCtrl+1', 'CmdOrCtrl+2'], () => {
      fired += 1;
    });
    expect(globalShortcut.isRegistered('CmdOrCtrl+1')).toBe(true);
    expect(globalShortcut.isRegistered('CmdOrCtrl+2')).toBe(true);
    fake.fire('CmdOrCtrl+1');
    fake.fire('CmdOrCtrl+2');
    expect(fired).toBe(2);
  });

  test('skips unparseable accelerators without throwing', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    expect(() =>
      globalShortcut.registerAll(['CmdOrCtrl+1', 'Boguskey+Boguskey2'], () => undefined),
    ).not.toThrow();
    expect(globalShortcut.isRegistered('CmdOrCtrl+1')).toBe(true);
  });
});

describe('globalShortcut.isRegistered', () => {
  test('is false for an accelerator that was never registered', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    expect(globalShortcut.isRegistered('CmdOrCtrl+Z')).toBe(false);
  });

  test('is false for an unparseable accelerator', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    expect(globalShortcut.isRegistered('not a real accel ###')).toBe(false);
  });
});

describe('globalShortcut.unregister', () => {
  test('removes the registration and tells the backend', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    globalShortcut.register('CmdOrCtrl+K', () => undefined);
    globalShortcut.unregister('CmdOrCtrl+K');
    expect(globalShortcut.isRegistered('CmdOrCtrl+K')).toBe(false);
    expect(fake.has('CmdOrCtrl+K')).toBe(false);
  });

  test('is a no-op for an accelerator that is not registered', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    expect(() => globalShortcut.unregister('CmdOrCtrl+K')).not.toThrow();
  });

  test('a re-register after unregister succeeds', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    globalShortcut.register('CmdOrCtrl+K', () => undefined);
    globalShortcut.unregister('CmdOrCtrl+K');
    expect(globalShortcut.register('CmdOrCtrl+K', () => undefined)).toBe(true);
  });
});

describe('globalShortcut.unregisterAll', () => {
  test('clears all registrations and tells the backend once', () => {
    const fake = makeFakeBackend();
    setGlobalShortcutBackendForTesting(fake.backend);
    globalShortcut.register('CmdOrCtrl+1', () => undefined);
    globalShortcut.register('CmdOrCtrl+2', () => undefined);
    globalShortcut.unregisterAll();
    expect(globalShortcut.isRegistered('CmdOrCtrl+1')).toBe(false);
    expect(globalShortcut.isRegistered('CmdOrCtrl+2')).toBe(false);
    expect(fake.calls.filter((c) => c === 'unregisterAll').length).toBe(1);
  });
});
