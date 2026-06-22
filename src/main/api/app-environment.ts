import { readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { currentPlatform, type Platform } from '../../common/platform';
import { findManifest, type Manifest, type ManifestReader } from './app-metadata';
import { normalizeLocale, parsePreferredLanguages } from './app-locale';

/**
 * Assembles the host facts the `app` module needs (paths, manifest, locale,
 * packaged-state) from injected primitives, so the assembly logic unit-tests
 * without touching the real OS. {@link defaultAppEnvironment} wires the live
 * `os`/`process`/`fs`/`Intl` values; tests pass synthetic {@link EnvironmentDeps}.
 */

/** Raw, injectable inputs used to build an {@link AppEnvironment}. */
export type EnvironmentDeps = {
  readonly platform: Platform;
  readonly home: string;
  readonly temp: string;
  readonly execPath: string;
  /** The entry script (`process.argv[1]`), or `''` if none. */
  readonly mainScript: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The raw locale tag from `Intl` or `$LANG`. */
  readonly locale: string;
  readonly readFile: ManifestReader;
  readonly exit: (code: number) => void;
  /** Spawn a detached copy of the app on exit (backs `app.relaunch`). */
  readonly relaunch: (execPath: string, args: string[]) => void;
};

/** Resolved environment consumed by the `app` module. */
export type AppEnvironment = {
  readonly platform: Platform;
  readonly home: string;
  readonly temp: string;
  readonly execPath: string;
  /** The application root directory (dir of the nearest `package.json`, or cwd). */
  readonly appPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly manifest: Manifest | undefined;
  /** Normalized BCP-47 locale (`''` if unknown). */
  readonly locale: string;
  readonly preferredLanguages: string[];
  readonly isPackaged: boolean;
  readonly exit: (code: number) => void;
  readonly relaunch: (execPath: string, args: string[]) => void;
};

/** Matches the dev-runner executables (`bun`, `bun-canary`, `node`). */
const DEV_RUNNER = /[/\\](bun|bun-[^/\\]+|node)$/;

/** Heuristic: a build is "packaged" unless it runs under the bun/node dev binary. */
const computeIsPackaged = (execPath: string): boolean => !DEV_RUNNER.test(execPath);

const computePreferredLanguages = (
  env: EnvironmentDeps['env'],
  normalizedLocale: string,
): string[] => {
  const fromEnv = parsePreferredLanguages(env);
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  return normalizedLocale.length > 0 ? [normalizedLocale] : [];
};

/** Build a resolved {@link AppEnvironment} from injected primitives. */
export const buildAppEnvironment = (deps: EnvironmentDeps): AppEnvironment => {
  const startDir = deps.mainScript.length > 0 ? dirname(deps.mainScript) : deps.cwd;
  const found = findManifest(startDir, deps.readFile);
  const locale = normalizeLocale(deps.locale);
  return {
    platform: deps.platform,
    home: deps.home,
    temp: deps.temp,
    execPath: deps.execPath,
    appPath: found?.dir ?? deps.cwd,
    env: deps.env,
    manifest: found?.manifest,
    locale,
    preferredLanguages: computePreferredLanguages(deps.env, locale),
    isPackaged: computeIsPackaged(deps.execPath),
    exit: deps.exit,
    relaunch: deps.relaunch,
  };
};

/** Read a file as UTF-8, returning `undefined` if it does not exist. */
const safeRead: ManifestReader = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Build the environment from the live host (`os`/`process`/`fs`/`Intl`). */
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
    // Spawn a detached copy as this process exits (Electron's relaunch-on-exit).
    relaunch: (execPath, args) => {
      process.once('exit', () => {
        try {
          Bun.spawn({ cmd: [execPath, ...args], stdio: ['ignore', 'ignore', 'ignore'] }).unref();
        } catch {
          // Best-effort: a failed relaunch must not crash the exiting process.
        }
      });
    },
  });
