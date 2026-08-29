import { describe, expect, test } from 'bun:test';
import {
  IMPLEMENTED_MODULES,
  isImplemented,
  KNOWN_ELECTRON_MODULES,
  notImplementedMessage,
} from '../../../src/main/module-list';

describe('IMPLEMENTED_MODULES', () => {
  test('every implemented module is also a known Electron module', () => {
    const known: readonly string[] = KNOWN_ELECTRON_MODULES;
    for (const name of IMPLEMENTED_MODULES) {
      expect(known).toContain(name);
    }
  });
});

describe('isImplemented', () => {
  test('is true for a shipped module', () => {
    expect(isImplemented('app')).toBe(true);
  });

  test('is false for a known-but-unshipped module', () => {
    expect(isImplemented('crashReporter')).toBe(false);
  });

  test('is false for an unknown name', () => {
    expect(isImplemented('TotallyMadeUp')).toBe(false);
  });
});

describe('notImplementedMessage', () => {
  test('names the module and the project', () => {
    const message = notImplementedMessage('Tray');
    expect(message).toMatch(/Tray/);
    expect(message).toMatch(/Bunmaska/);
    expect(message).toMatch(/not yet implemented/i);
  });
});
