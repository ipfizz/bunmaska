import { posix, win32 } from 'node:path';
import { InvalidArgumentError } from '../../common/errors';
import type { Platform } from '../../common/platform';

const APP_PATH_NAMES = [
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
] as const;

export type AppPathName = (typeof APP_PATH_NAMES)[number];

export type PathEnvironment = {
  readonly platform: Platform;
  readonly home: string;
  readonly temp: string;
  /** Names the per-app `userData` subdirectory. */
  readonly appName: string;
  readonly execPath: string;
  /** Linux `XDG_*` values (from the environment or `user-dirs.dirs`) and Windows `APPDATA`. */
  readonly env: Readonly<Record<string, string | undefined>>;
};

const KNOWN_NAMES: ReadonlySet<string> = new Set(APP_PATH_NAMES);

export const isAppPathName = (name: string): name is AppPathName => KNOWN_NAMES.has(name);

/** Home-relative user folders; Linux consults `xdg` first. */
const USER_FOLDERS = {
  desktop: { dir: 'Desktop', xdg: 'XDG_DESKTOP_DIR' },
  documents: { dir: 'Documents', xdg: 'XDG_DOCUMENTS_DIR' },
  downloads: { dir: 'Downloads', xdg: 'XDG_DOWNLOAD_DIR' },
  music: { dir: 'Music', xdg: 'XDG_MUSIC_DIR' },
  pictures: { dir: 'Pictures', xdg: 'XDG_PICTURES_DIR' },
  videos: { dir: 'Videos', xdg: 'XDG_VIDEOS_DIR' },
} as const;

const envDir = (env: PathEnvironment['env'], variable: string, fallback: string): string => {
  const value = env[variable];
  return value !== undefined && value.length > 0 ? value : fallback;
};

/** Throws {@link InvalidArgumentError} on an unrecognized name, matching Electron. */
export const resolveAppPath = (name: AppPathName, e: PathEnvironment): string => {
  if (!isAppPathName(name)) {
    throw new InvalidArgumentError(`Failed to get '${name}' path: unknown path name`);
  }
  // The TARGET platform's separator, not the host's, so every platform resolves on any CI host.
  const { join } = e.platform === 'windows' ? win32 : posix;
  const appData =
    e.platform === 'macos'
      ? join(e.home, 'Library', 'Application Support')
      : e.platform === 'windows'
        ? envDir(e.env, 'APPDATA', join(e.home, 'AppData', 'Roaming'))
        : envDir(e.env, 'XDG_CONFIG_HOME', join(e.home, '.config'));
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
    case 'module':
      return e.execPath;
    case 'logs':
      return e.platform === 'macos'
        ? join(e.home, 'Library', 'Logs', e.appName)
        : join(userData, 'logs');
    case 'crashDumps':
      return join(userData, 'Crashpad');
    default: {
      const folder = USER_FOLDERS[name];
      if (e.platform === 'macos') {
        return join(e.home, name === 'videos' ? 'Movies' : folder.dir);
      }
      // ponytail: Windows ignores Known Folder redirection (OneDrive); SHGetKnownFolderPath if it bites.
      const fallback = join(e.home, folder.dir);
      return e.platform === 'linux' ? envDir(e.env, folder.xdg, fallback) : fallback;
    }
  }
};
