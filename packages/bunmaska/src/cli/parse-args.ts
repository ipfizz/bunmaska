/**
 * Pure argument parser for the `bunmaska` CLI.
 *
 * Maps a raw argv tail (no node/bun/script prefix) to a {@link Command}
 * discriminated union. {@link parseArgs} does no I/O and never reads `process`,
 * so every branch is unit-testable. The lone exception is {@link resolveTarget},
 * which folds in the host platform default and is kept here beside its type.
 */

import { currentPlatform } from '../common/platform';

/** Build targets `bunmaska build` can produce. */
export type BuildTarget = 'macos' | 'linux' | 'windows';

/** Options accepted by `bunmaska build`. All optional; the bundler fills defaults. */
export type BuildOptions = {
  readonly name?: string;
  readonly id?: string;
  readonly out?: string;
  readonly icon?: string;
  readonly target?: BuildTarget;
  /** macOS code-signing identity (`-` = ad-hoc). Real Developer-ID needs the cert in the keychain. */
  readonly sign?: string;
  /** Request notarization (a documented hook; requires Apple credentials to actually run). */
  readonly notarize?: boolean;
  /** Also produce a `.dmg` containing the built `.app` (macOS-only; uses hdiutil). */
  readonly dmg?: boolean;
  /** Release channel for the update feed (default: `stable`). */
  readonly channel?: string;
  /** Also emit the auto-update feed: a `.tar.zst` of the bundle + `update.json`. */
  readonly update?: boolean;
  /** Windows: directory of a WinCairo WebKit engine to bundle so the `.exe` self-contains it. */
  readonly embedEngine?: string;
};

/** Subcommands of `bunmaska engine`, for managing the pinned-WebKit store. */
export type EngineSubcommand =
  | { readonly action: 'list' }
  | { readonly action: 'which'; readonly target?: string }
  | { readonly action: 'install'; readonly source: string }
  | { readonly action: 'use'; readonly id: string; readonly for?: string }
  | { readonly action: 'prune'; readonly dryRun: boolean; readonly force: boolean }
  | { readonly action: 'verify'; readonly id: string };

export type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'init'; readonly dir: string }
  | { readonly kind: 'dev'; readonly entry?: string }
  | { readonly kind: 'run'; readonly entry: string; readonly args: readonly string[] }
  | { readonly kind: 'build'; readonly entry: string; readonly options: BuildOptions }
  | { readonly kind: 'engine'; readonly sub: EngineSubcommand }
  | { readonly kind: 'doctor'; readonly target?: string }
  | { readonly kind: 'error'; readonly message: string };

/** `bunmaska build` flags that take a string value, keyed by argv token. */
const BUILD_STRING_FLAGS = new Map<
  string,
  'name' | 'id' | 'out' | 'icon' | 'sign' | 'channel' | 'embedEngine'
>([
  ['--name', 'name'],
  ['--id', 'id'],
  ['--out', 'out'],
  ['--icon', 'icon'],
  ['--sign', 'sign'],
  ['--channel', 'channel'],
  ['--embed-engine', 'embedEngine'],
]);

/** `bunmaska build` boolean flags that take no value, by argv token. */
const BUILD_BOOLEAN_FLAGS: ReadonlySet<string> = new Set<string>([
  '--notarize',
  '--dmg',
  '--update',
]);

const BUILD_TARGETS: ReadonlySet<BuildTarget> = new Set<BuildTarget>(['macos', 'linux', 'windows']);

const isBuildTarget = (value: string): value is BuildTarget =>
  BUILD_TARGETS.has(value as BuildTarget);

const parseInit = (rest: readonly string[]): Command => {
  const [dir, ...extra] = rest;
  if (extra.length > 0) {
    return { kind: 'error', message: `bunmaska init: unexpected argument ${extra[0]}` };
  }
  return { kind: 'init', dir: dir ?? '.' };
};

const parseDev = (rest: readonly string[]): Command => {
  const [entry, ...extra] = rest;
  if (extra.length > 0) {
    return { kind: 'error', message: `bunmaska dev: unexpected argument ${extra[0]}` };
  }
  return entry === undefined ? { kind: 'dev' } : { kind: 'dev', entry };
};

const parseRun = (rest: readonly string[]): Command => {
  const [entry, ...args] = rest;
  if (entry === undefined) {
    return { kind: 'error', message: 'bunmaska run: missing <entry.ts>' };
  }
  return { kind: 'run', entry, args };
};

const parseBuild = (rest: readonly string[]): Command => {
  let entry: string | undefined;
  const options: { -readonly [K in keyof BuildOptions]: BuildOptions[K] } = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === undefined) {
      continue;
    }
    if (token.startsWith('--')) {
      if (BUILD_BOOLEAN_FLAGS.has(token)) {
        if (token === '--notarize') {
          options.notarize = true;
        } else if (token === '--dmg') {
          options.dmg = true;
        } else if (token === '--update') {
          options.update = true;
        }
        continue;
      }
      if (token === '--target') {
        const value = rest[i + 1];
        if (value === undefined) {
          return { kind: 'error', message: `bunmaska build: flag ${token} requires a value` };
        }
        if (!isBuildTarget(value)) {
          return {
            kind: 'error',
            message: `bunmaska build: --target must be macos, linux or windows (got ${value})`,
          };
        }
        options.target = value;
        i += 1;
        continue;
      }
      const key = BUILD_STRING_FLAGS.get(token);
      if (key === undefined) {
        return { kind: 'error', message: `bunmaska build: unknown flag ${token}` };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return { kind: 'error', message: `bunmaska build: flag ${token} requires a value` };
      }
      options[key] = value;
      i += 1;
      continue;
    }
    if (entry === undefined) {
      entry = token;
      continue;
    }
    return { kind: 'error', message: `bunmaska build: unexpected argument ${token}` };
  }

  if (entry === undefined) {
    return { kind: 'error', message: 'bunmaska build: missing <entry.ts>' };
  }
  return { kind: 'build', entry, options };
};

/** Parse the `bunmaska engine <action> …` tail into a {@link Command}. */
const parseEngine = (rest: readonly string[]): Command => {
  const [action, ...args] = rest;
  if (action === undefined) {
    return { kind: 'error', message: 'bunmaska engine: missing subcommand' };
  }
  switch (action) {
    case 'list':
      return { kind: 'engine', sub: { action: 'list' } };
    case 'which': {
      const target = args[0];
      return {
        kind: 'engine',
        sub: target === undefined ? { action: 'which' } : { action: 'which', target },
      };
    }
    case 'install': {
      const source = args[0];
      if (source === undefined) {
        return { kind: 'error', message: 'bunmaska engine install: missing <id|path>' };
      }
      return { kind: 'engine', sub: { action: 'install', source } };
    }
    case 'use': {
      const id = args[0];
      if (id === undefined) {
        return { kind: 'error', message: 'bunmaska engine use: missing <engine-id>' };
      }
      let forDir: string | undefined;
      for (let i = 1; i < args.length; i += 1) {
        const token = args[i];
        if (token === '--for') {
          const value = args[i + 1];
          if (value === undefined) {
            return { kind: 'error', message: 'bunmaska engine use: --for requires a directory' };
          }
          forDir = value;
          i += 1;
          continue;
        }
        return { kind: 'error', message: `bunmaska engine use: unexpected argument ${token}` };
      }
      return {
        kind: 'engine',
        sub: forDir === undefined ? { action: 'use', id } : { action: 'use', id, for: forDir },
      };
    }
    case 'prune':
      return {
        kind: 'engine',
        sub: {
          action: 'prune',
          dryRun: args.includes('--dry-run'),
          force: args.includes('--force'),
        },
      };
    case 'verify': {
      const id = args[0];
      if (id === undefined) {
        return { kind: 'error', message: 'bunmaska engine verify: missing <engine-id>' };
      }
      return { kind: 'engine', sub: { action: 'verify', id } };
    }
    default:
      return { kind: 'error', message: `bunmaska engine: unknown subcommand '${action}'` };
  }
};

/** Parse the argv tail into a {@link Command}. Never throws. */
export const parseArgs = (argv: readonly string[]): Command => {
  const [head, ...rest] = argv;
  if (head === undefined || head === '--help' || head === '-h' || head === 'help') {
    return { kind: 'help' };
  }
  if (head === '--version' || head === '-v') {
    return { kind: 'version' };
  }
  if (head === 'init') {
    return parseInit(rest);
  }
  if (head === 'dev') {
    return parseDev(rest);
  }
  if (head === 'run') {
    return parseRun(rest);
  }
  if (head === 'build') {
    return parseBuild(rest);
  }
  if (head === 'engine') {
    return parseEngine(rest);
  }
  if (head === 'doctor') {
    const target = rest[0];
    return target === undefined ? { kind: 'doctor' } : { kind: 'doctor', target };
  }
  return { kind: 'error', message: `bunmaska: unknown command '${head}'` };
};

/**
 * Resolve the effective build target: an explicit `--target` when given,
 * otherwise the host platform (each host builds its own OS by default). The
 * platform tags and build-target tags coincide, so the host maps straight
 * through; explicit `--target` still allows cross-builds (e.g. macOS → linux).
 */
export const resolveTarget = (target: BuildTarget | undefined): BuildTarget =>
  target ?? currentPlatform();
