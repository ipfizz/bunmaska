import { selectBackend } from '../platform/index';
import * as gtkShell from '../platform/linux/gtk-shell';
import * as cocoaShell from '../platform/macos/cocoa-shell';
import { windowsShellBackend } from '../platform/windows/windows-shell';
import type { ShellBackend } from '../platform/services';

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

const { get: getBackend, setForTesting } = selectBackend<ShellBackend>('shell', {
  macos: () => macosBackend,
  linux: () => linuxBackend,
  windows: () => windowsShellBackend,
});

/** @internal */
export const setShellBackendForTesting = setForTesting;

export type Shell = {
  /** Resolves `false` for a non-URL or a failed launch. */
  openExternal(url: string): Promise<boolean>;
  /** Resolves `''` on success, else an error string. */
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
  beep(): void;
};

/**
 * An absolute URL only, as Electron requires. Windows `ShellExecuteW` would otherwise run a
 * bare path or program name (`C:\x\payload.exe`, `calc`), and a one-letter scheme is a drive.
 */
const isExternalUrl = (url: string): boolean =>
  URL.canParse(url) && new URL(url).protocol.length > 2;

export const shell: Shell = {
  openExternal(url) {
    return Promise.resolve(isExternalUrl(url) && getBackend().openExternal(url));
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
