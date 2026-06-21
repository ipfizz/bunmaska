import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import * as gtkShell from '../platform/linux/gtk-shell';
import * as cocoaShell from '../platform/macos/cocoa-shell';
import { windowsShellBackend } from '../platform/windows/windows-shell';

/**
 * Desktop integration — the drop-in equivalent of Electron's `shell`.
 *
 * `openExternal` returns a Promise (matching Electron); the rest are
 * synchronous. The native backend is injectable so the surface is unit-testable
 * without launching real applications.
 */

export type ShellBackend = {
  openExternal(url: string): boolean;
  openPath(path: string): boolean;
  showItemInFolder(path: string): void;
  beep(): void;
};

const macosBackend: ShellBackend = {
  openExternal: (url) => cocoaShell.openExternal(url),
  openPath: (path) => cocoaShell.openPath(path),
  showItemInFolder: (path) => cocoaShell.showItemInFolder(path),
  beep: () => cocoaShell.beep(),
};

const linuxBackend: ShellBackend = {
  openExternal: (url) => gtkShell.openExternal(url),
  openPath: (path) => gtkShell.openPath(path),
  showItemInFolder: (path) => gtkShell.showItemInFolder(path),
  beep: () => gtkShell.beep(),
};

let backend: ShellBackend | undefined;

const getBackend = (): ShellBackend => {
  if (backend !== undefined) {
    return backend;
  }
  if (currentPlatform() === 'macos') {
    return macosBackend;
  }
  if (currentPlatform() === 'linux') {
    return linuxBackend;
  }
  if (currentPlatform() === 'windows') {
    return windowsShellBackend;
  }
  throw new UnsupportedPlatformError(`shell is not supported on ${currentPlatform()} yet`);
};

/** Override the native shell backend. Test-only. */
export const setShellBackendForTesting = (fake: ShellBackend | undefined): void => {
  backend = fake;
};

export type Shell = {
  /** Open a URL in the default application. Resolves with whether it succeeded. */
  openExternal(url: string): Promise<boolean>;
  /** Open a file or folder with its default application. Returns `''` on success or an error string. */
  openPath(path: string): Promise<string>;
  /** Reveal a file or folder in the OS file manager. */
  showItemInFolder(path: string): void;
  /** Play the system beep. */
  beep(): void;
};

export const shell: Shell = {
  openExternal(url) {
    return Promise.resolve(getBackend().openExternal(url));
  },
  openPath(path) {
    const ok = getBackend().openPath(path);
    return Promise.resolve(ok ? '' : `Failed to open path: ${path}`);
  },
  showItemInFolder(path) {
    getBackend().showItemInFolder(path);
  },
  beep() {
    getBackend().beep();
  },
};
