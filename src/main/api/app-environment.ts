import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, posix } from 'node:path';
import { currentPlatform, type Platform } from '../../common/platform';
import { findManifest, type Manifest, type ManifestReader, readManifest } from './app-metadata';
import { normalizeLocale, parsePreferredLanguages } from './app-locale';

export type EnvironmentDeps = {
  readonly platform: Platform;
  readonly home: string;
  readonly temp: string;
  readonly execPath: string;
  /** The entry script (`process.argv[1]`), or `''` if none. */
  readonly mainScript: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The raw `Intl` locale tag. */
  readonly locale: string;
  readonly readFile: ManifestReader;
  readonly exit: (code: number) => void;
  /** Spawns the app again once this process exits (`app.relaunch`). */
  readonly relaunch: (execPath: string, args: string[]) => void;
};

export type AppEnvironment = {
  readonly platform: Platform;
  readonly home: string;
  readonly temp: string;
  readonly execPath: string;
  readonly appPath: string;
  /** `process.env`, plus the Linux `user-dirs.dirs` entries. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly manifest: Manifest | undefined;
  /** Normalized BCP-47 locale (`''` if unknown). */
  readonly locale: string;
  readonly preferredLanguages: string[];
  readonly isPackaged: boolean;
  readonly exit: (code: number) => void;
  readonly relaunch: (execPath: string, args: string[]) => void;
};

/** A `bun build --compile` binary runs its entry from Bun's embedded filesystem. */
const COMPILED_ENTRY = /^(?:\/\$bunfs\/|[A-Za-z]:[\\/]~BUN[\\/])/;

/** `$LANGUAGE`/`$LANG` only on Linux: macOS and Windows `Intl` follow the system, not the env. */
const computePreferredLanguages = (deps: EnvironmentDeps, normalizedLocale: string): string[] => {
  const fromEnv = deps.platform === 'linux' ? parsePreferredLanguages(deps.env) : [];
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  return normalizedLocale.length > 0 ? [normalizedLocale] : [];
};

const locateApp = (deps: EnvironmentDeps): { dir: string; manifest: Manifest | undefined } => {
  if (COMPILED_ENTRY.test(deps.mainScript)) {
    // The build ships assets and package.json beside the binary; walking above it
    // would adopt whatever package.json the install location happens to sit under.
    const dir = dirname(deps.execPath);
    return { dir, manifest: readManifest(dir, deps.readFile) };
  }
  const startDir = deps.mainScript.length > 0 ? dirname(deps.mainScript) : deps.cwd;
  const found = findManifest(startDir, deps.readFile);
  return { dir: found?.dir ?? deps.cwd, manifest: found?.manifest };
};

/** The absolute `XDG_<NAME>_DIR` entries of xdg-user-dirs' `user-dirs.dirs`, `$HOME` expanded. */
const readUserDirs = (deps: EnvironmentDeps): Record<string, string> => {
  const configHome = deps.env['XDG_CONFIG_HOME'] || posix.join(deps.home, '.config');
  const text = deps.readFile(posix.join(configHome, 'user-dirs.dirs')) ?? '';
  const dirs: Record<string, string> = {};
  for (const [, key = '', value = ''] of text.matchAll(/^[ \t]*(XDG_\w+_DIR)="([^"]*)"/gm)) {
    const dir = value.replace(/^\$HOME(?=\/|$)/, deps.home);
    if (dir.startsWith('/')) {
      dirs[key] = dir;
    }
  }
  return dirs;
};

export const buildAppEnvironment = (deps: EnvironmentDeps): AppEnvironment => {
  const app = locateApp(deps);
  const locale = normalizeLocale(deps.locale);
  return {
    platform: deps.platform,
    home: deps.home,
    temp: deps.temp,
    execPath: deps.execPath,
    appPath: app.dir,
    // Desktop sessions keep the localized user folders in the file, not the environment.
    env: deps.platform === 'linux' ? { ...readUserDirs(deps), ...deps.env } : deps.env,
    manifest: app.manifest,
    locale,
    preferredLanguages: computePreferredLanguages(deps, locale),
    isPackaged: COMPILED_ENTRY.test(deps.mainScript),
    exit: deps.exit,
    relaunch: deps.relaunch,
  };
};

const safeRead: ManifestReader = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

export const defaultAppEnvironment = (): AppEnvironment =>
  buildAppEnvironment({
    platform: currentPlatform(),
    home: homedir(),
    temp: tmpdir(),
    execPath: process.execPath,
    mainScript: process.argv[1] ?? '',
    cwd: process.cwd(),
    env: process.env,
    locale: new Intl.DateTimeFormat().resolvedOptions().locale,
    readFile: safeRead,
    exit: (code) => process.exit(code),
    relaunch: (execPath, args) => {
      // Prepended: the Windows backend's exit listener TerminateProcess-es (D043).
      process.prependOnceListener('exit', () => {
        try {
          Bun.spawn({ cmd: [execPath, ...args], stdio: ['ignore', 'ignore', 'ignore'] }).unref();
        } catch {
          // Best-effort: a failed relaunch must not crash the exiting process.
        }
      });
    },
  });
