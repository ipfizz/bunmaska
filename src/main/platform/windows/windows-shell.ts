import { ptr } from 'bun:ffi';
import type { ShellBackend } from '../../api/shell';
import { wstr } from './win32';
import { loadUser32 } from './win32-ffi';
import { loadShell32, SHELL_EXECUTE_SUCCESS_THRESHOLD, SW_SHOWNORMAL } from './win32-shell-ffi';

/**
 * Windows `shell` backend. Each wide-string buffer is held in a local so it stays alive
 * across the `ShellExecuteW` call.
 */

/** Run `ShellExecuteW(NULL, "open", target, params)` and report success (HINSTANCE > 32). */
const shellOpen = (target: string, params?: string): boolean => {
  const verbBuf = wstr('open');
  const targetBuf = wstr(target);
  const paramsBuf = params === undefined ? undefined : wstr(params);
  const result = loadShell32().symbols.ShellExecuteW(
    0n,
    ptr(verbBuf),
    ptr(targetBuf),
    paramsBuf === undefined ? null : ptr(paramsBuf),
    null,
    SW_SHOWNORMAL,
  );
  return result > SHELL_EXECUTE_SUCCESS_THRESHOLD;
};

export const windowsShellBackend: ShellBackend = {
  openExternal(url: string): boolean {
    return shellOpen(url);
  },

  openPath(path: string): boolean {
    return shellOpen(path);
  },

  showItemInFolder(path: string): void {
    // Open Explorer with the item selected (quotes guard a path with spaces).
    shellOpen('explorer.exe', `/select,"${path}"`);
  },

  beep(): void {
    loadUser32().symbols.MessageBeep(0xffffffff);
  },
};
