import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { shell } from '../../../src/main/api/shell';
import { windowsShellBackend } from '../../../src/main/platform/windows/windows-shell';

/**
 * Windows shell backend against the real ShellExecuteW/MessageBeep APIs. Only the
 * SIDE-EFFECT-FREE paths run: `beep` (a sound), and the FAILURE return of
 * `openPath` on a non-existent path (ShellExecuteW returns <= 32, nothing
 * launches). `openExternal` shares the exact same `ShellExecuteW("open", …)` code
 * path, so its boolean contract is covered here too; its success path and
 * `showItemInFolder` are not exercised because they would launch a browser /
 * Explorer window. Runs only on a Windows host; inert elsewhere.
 */
const NON_EXISTENT = 'C:\\bunmaska_definitely_not_a_real_path_zzz\\nope.txt';

if (currentPlatform() === 'windows') {
  describe('Windows shell backend', () => {
    test('beep does not throw', () => {
      expect(() => windowsShellBackend.beep()).not.toThrow();
    });

    test('openPath on a non-existent path returns false (no launch)', () => {
      expect(windowsShellBackend.openPath(NON_EXISTENT)).toBe(false);
    });

    test('exposes openExternal and showItemInFolder', () => {
      expect(typeof windowsShellBackend.openExternal).toBe('function');
      expect(typeof windowsShellBackend.showItemInFolder).toBe('function');
    });

    test('the public shell.openPath surfaces the failure as an error string', async () => {
      const result = await shell.openPath(NON_EXISTENT);
      expect(result).toContain('Failed to open path');
    });

    test('the public shell.beep delegates without throwing', () => {
      expect(() => shell.beep()).not.toThrow();
    });
  });
}
