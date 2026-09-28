import { service } from '../platform/index';

const { get: getBackend, setForTesting } = service('shell');

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
