import { UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import * as gtkShell from '../platform/linux/gtk-shell';
import * as cocoaShell from '../platform/macos/cocoa-shell';
import { windowsShellBackend } from '../platform/windows/windows-shell';

/**
 * Desktop integration — the drop-in equivalent of Electron's `shell`.
 * `openExternal` returns a Promise, matching Electron; the rest are synchronous.
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

/** @internal */
export const setShellBackendForTesting = (fake: ShellBackend | undefined): void => {
  backend = fake;
};

export type Shell = {
  /** Resolves with whether the launch succeeded. */
  openExternal(url: string): Promise<boolean>;
  /** Resolves `''` on success, else an error string. */
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
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
