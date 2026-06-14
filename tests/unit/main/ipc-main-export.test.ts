import { describe, expect, test } from 'bun:test';
import * as bunmaska from '../../../src/main';

describe('public barrel exports ipcMain', () => {
  test('ipcMain is reachable from the package entry point', () => {
    expect(bunmaska.ipcMain).toBeDefined();
  });

  test('ipcMain exposes the Electron-compatible surface', () => {
    for (const method of [
      'on',
      'once',
      'removeListener',
      'handle',
      'handleOnce',
      'removeHandler',
    ]) {
      expect(typeof (bunmaska.ipcMain as unknown as Record<string, unknown>)[method]).toBe(
        'function',
      );
    }
  });
});
