import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setShellBackendForTesting, shell } from '../../../../src/main/api/shell';
import type { ShellBackend } from '../../../../src/main/platform/services';

let calls: string[];
let openExternalResult = true;
let openPathResult = true;

beforeEach(() => {
  calls = [];
  openExternalResult = true;
  openPathResult = true;
  const fake: ShellBackend = {
    openExternal: (url) => {
      calls.push(`openExternal:${url}`);
      return openExternalResult;
    },
    openPath: (path) => {
      calls.push(`openPath:${path}`);
      return openPathResult;
    },
    showItemInFolder: (path) => {
      calls.push(`showItemInFolder:${path}`);
    },
    beep: () => {
      calls.push('beep');
    },
  };
  setShellBackendForTesting(fake);
});

afterEach(() => {
  setShellBackendForTesting(undefined);
});

describe('shell.openExternal', () => {
  test('forwards the URL and resolves with the backend result', async () => {
    expect(await shell.openExternal('https://example.com')).toBe(true);
    expect(calls).toEqual(['openExternal:https://example.com']);
  });

  test('resolves false for a path or program name without reaching the backend', async () => {
    for (const notAUrl of ['calc', 'C:\\Users\\x\\payload.exe', 'c:/x.exe', '/etc/passwd']) {
      expect(await shell.openExternal(notAUrl)).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  test('resolves false when the backend reports failure', async () => {
    openExternalResult = false;
    expect(await shell.openExternal('bad:')).toBe(false);
  });
});

describe('shell.openPath', () => {
  test('resolves empty string on success', async () => {
    expect(await shell.openPath('/tmp/x')).toBe('');
  });

  test('resolves an error string on failure', async () => {
    openPathResult = false;
    expect(await shell.openPath('/nope')).toBe('Failed to open path: /nope');
  });
});
