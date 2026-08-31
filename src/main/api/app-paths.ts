import { posix, win32 } from 'node:path';
import { InvalidArgumentError } from '../../common/errors';
import type { Platform } from '../../common/platform';

/**
 * Pure resolution of Electron's `app.getPath(name)` special directories.
 *
 * Each resolver joins with its TARGET platform's separator (`path.posix` for
 * macOS/Linux, `path.win32` for Windows) rather than the host's `path.join`, so
 * a macOS path resolves with `/` even when this runs on a Windows CI host, and
 * vice versa.
 */

export type AppPathName =
  | 'home'
  | 'appData'
  | 'userData'
  | 'sessionData'
  | 'temp'
  | 'exe'
  | 'module'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos'
  | 'logs'
  | 'crashDumps';

export type PathEnvironment = {
  readonly platform: Platform;
  /** `os.homedir()`. */
  readonly home: string;
  /** `os.tmpdir()`. */
  readonly temp: string;
  /** Names the per-app `userData` subdirectory. */
  readonly appName: string;
  /** `process.execPath`. */
  readonly execPath: string;
  /** `app.getAppPath()`. */
  readonly appPath: string;
  /** Consulted for the Linux XDG overrides. */
  readonly env: Readonly<Record<string, string | undefined>>;
};

const KNOWN_NAMES: ReadonlySet<string> = new Set<AppPathName>([
  'home',
  'appData',
  'userData',
  'sessionData',
  'temp',
  'exe',
  'module',
  'desktop',
  'documents',
  'downloads',
  'music',
  'pictures',
  'videos',
  'logs',
  'crashDumps',
]);

const envDir = (env: PathEnvironment['env'], variable: string, fallback: string): string => {
  const value = env[variable];
  return value !== undefined && value.length > 0 ? value : fallback;
};

/** Linux XDG user-dir lookup: `$VAR` if set and non-empty, else `home/fallback`. */
const xdgDir = (env: PathEnvironment['env'], variable: string, home: string, fallback: string) =>
  envDir(env, variable, posix.join(home, fallback));

const resolveMacOS = (name: AppPathName, e: PathEnvironment): string => {
  const { join } = posix;
  const appSupport = join(e.home, 'Library', 'Application Support');
  const userData = join(appSupport, e.appName);
  switch (name) {
    case 'home':
      return e.home;
    case 'appData':
      return appSupport;
    case 'userData':
    case 'sessionData':
      return userData;
    case 'temp':
      return e.temp;
    case 'exe':
      return e.execPath;
    case 'module':
      return e.appPath;
    case 'desktop':
      return join(e.home, 'Desktop');
    case 'documents':
      return join(e.home, 'Documents');
    case 'downloads':
      return join(e.home, 'Downloads');
    case 'music':
      return join(e.home, 'Music');
    case 'pictures':
      return join(e.home, 'Pictures');
    case 'videos':
      return join(e.home, 'Movies');
    case 'logs':
      return join(e.home, 'Library', 'Logs', e.appName);
    case 'crashDumps':
      return join(userData, 'Crashpad');
  }
};

const resolveLinux = (name: AppPathName, e: PathEnvironment): string => {
  const { join } = posix;
  const appData = xdgDir(e.env, 'XDG_CONFIG_HOME', e.home, '.config');
  const userData = join(appData, e.appName);
  switch (name) {
    case 'home':
      return e.home;
    case 'appData':
      return appData;
    case 'userData':
    case 'sessionData':
      return userData;
    case 'temp':
      return e.temp;
    case 'exe':
      return e.execPath;
    case 'module':
      return e.appPath;
    case 'desktop':
      return xdgDir(e.env, 'XDG_DESKTOP_DIR', e.home, 'Desktop');
    case 'documents':
      return xdgDir(e.env, 'XDG_DOCUMENTS_DIR', e.home, 'Documents');
    case 'downloads':
      return xdgDir(e.env, 'XDG_DOWNLOAD_DIR', e.home, 'Downloads');
    case 'music':
      return xdgDir(e.env, 'XDG_MUSIC_DIR', e.home, 'Music');
    case 'pictures':
      return xdgDir(e.env, 'XDG_PICTURES_DIR', e.home, 'Pictures');
    case 'videos':
      return xdgDir(e.env, 'XDG_VIDEOS_DIR', e.home, 'Videos');
    case 'logs':
      return join(userData, 'logs');
    case 'crashDumps':
      return join(userData, 'Crashpad');
  }
};

const resolveWindows = (name: AppPathName, e: PathEnvironment): string => {
  const { join } = win32;
  const appData = envDir(e.env, 'APPDATA', join(e.home, 'AppData', 'Roaming'));
  const userData = join(appData, e.appName);
  switch (name) {
    case 'home':
      return e.home;
    case 'appData':
      return appData;
    case 'userData':
    case 'sessionData':
      return userData;
    case 'temp':
      return e.temp;
    case 'exe':
      return e.execPath;
    case 'module':
      return e.appPath;
    case 'desktop':
      return join(e.home, 'Desktop');
    case 'documents':
      return join(e.home, 'Documents');
    case 'downloads':
      return join(e.home, 'Downloads');
    case 'music':
      return join(e.home, 'Music');
    case 'pictures':
      return join(e.home, 'Pictures');
    case 'videos':
      return join(e.home, 'Videos');
    case 'logs':
      return join(userData, 'logs');
    case 'crashDumps':
      return join(userData, 'Crashpad');
  }
};

/** Throws {@link InvalidArgumentError} on an unrecognized name, matching Electron. */
export const resolveAppPath = (name: AppPathName, environment: PathEnvironment): string => {
  if (!KNOWN_NAMES.has(name)) {
    throw new InvalidArgumentError(`Failed to get '${name}' path: unknown path name`);
  }
  switch (environment.platform) {
    case 'macos':
      return resolveMacOS(name, environment);
    case 'windows':
      return resolveWindows(name, environment);
    default:
      return resolveLinux(name, environment);
  }
};
