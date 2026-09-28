/**
 * Maps a raw argv tail (no node/bun/script prefix) to a {@link Command}
 * discriminated union.
 */

import { currentPlatform } from '../common/platform';

export type BuildTarget = 'macos' | 'linux' | 'windows';

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
  /** PEM private key file that signs the `--update` artifact (`.sig` beside the `.tar.zst`). */
  readonly updateKey?: string;
  /** Windows: directory of a WinCairo WebKit engine to bundle so the `.exe` self-contains it. */
  readonly embedEngine?: string;
};

export type EngineSubcommand =
  | { readonly action: 'list' }
  | { readonly action: 'available' }
  | { readonly action: 'which'; readonly target?: string }
  | { readonly action: 'install'; readonly source: string }
  | { readonly action: 'use'; readonly id: string; readonly for?: string }
  | { readonly action: 'prune'; readonly dryRun: boolean; readonly force: boolean }
  | { readonly action: 'verify'; readonly id: string };

export type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'init'; readonly dir: string; readonly name?: string }
  | { readonly kind: 'dev'; readonly entry?: string }
  | { readonly kind: 'run'; readonly entry: string; readonly args: readonly string[] }
  | { readonly kind: 'build'; readonly entry?: string; readonly options: BuildOptions }
  | { readonly kind: 'engine'; readonly sub: EngineSubcommand }
  | { readonly kind: 'keygen'; readonly out?: string }
  | { readonly kind: 'doctor'; readonly target?: string }
  | { readonly kind: 'error'; readonly message: string };

const BUILD_STRING_FLAGS = new Map<
  string,
  'name' | 'id' | 'out' | 'icon' | 'sign' | 'channel' | 'embedEngine' | 'updateKey'
>([
  ['--name', 'name'],
  ['--id', 'id'],
  ['--out', 'out'],
  ['--icon', 'icon'],
  ['--sign', 'sign'],
  ['--channel', 'channel'],
  ['--update-key', 'updateKey'],
  ['--embed-engine', 'embedEngine'],
]);

const BUILD_BOOLEAN_FLAGS: ReadonlySet<string> = new Set<string>([
  '--notarize',
  '--dmg',
  '--update',
]);

const BUILD_TARGETS: ReadonlySet<BuildTarget> = new Set<BuildTarget>(['macos', 'linux', 'windows']);

const isBuildTarget = (value: string): value is BuildTarget =>
  BUILD_TARGETS.has(value as BuildTarget);

/** The error for the first flag-like or past-`max` argument of a positional-only command. */
const unexpected = (command: string, args: readonly string[], max: number): Command | undefined => {
  const bad = args.find((arg, i) => i >= max || arg.startsWith('-'));
  return bad === undefined
    ? undefined
    : { kind: 'error', message: `bunmaska ${command}: unexpected argument ${bad}` };
};

/** `init [dir]` scaffolds into dir; `init <name> <dir>` also names the app. */
const parseInit = (rest: readonly string[]): Command => {
  const error = unexpected('init', rest, 2);
  if (error !== undefined) {
    return error;
  }
  const [first, second] = rest;
  if (first !== undefined && second !== undefined) {
    return { kind: 'init', dir: second, name: first };
  }
  return { kind: 'init', dir: first ?? '.' };
};

const parseDev = (rest: readonly string[]): Command => {
  const [entry] = rest;
  return (
    unexpected('dev', rest, 1) ?? (entry === undefined ? { kind: 'dev' } : { kind: 'dev', entry })
  );
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

  // A missing entry is legal here: dispatch falls back to the config's `entry`.
  return entry === undefined ? { kind: 'build', options } : { kind: 'build', entry, options };
};

const parseKeygen = (rest: readonly string[]): Command => {
  let outDir: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === undefined) {
      continue;
    }
    if (token === '--out') {
      const value = rest[i + 1];
      if (value === undefined) {
        return { kind: 'error', message: 'bunmaska keygen: --out requires a directory' };
      }
      outDir = value;
      i += 1;
      continue;
    }
    return { kind: 'error', message: `bunmaska keygen: unexpected argument ${token}` };
  }
  return outDir === undefined ? { kind: 'keygen' } : { kind: 'keygen', out: outDir };
};

const parseEngine = (rest: readonly string[]): Command => {
  const [action, ...args] = rest;
  if (action === undefined) {
    return { kind: 'error', message: 'bunmaska engine: missing subcommand' };
  }
  const positional = (max: number): Command | undefined =>
    unexpected(`engine ${action}`, args, max);
  switch (action) {
    case 'list':
      return positional(0) ?? { kind: 'engine', sub: { action: 'list' } };
    case 'available':
      return positional(0) ?? { kind: 'engine', sub: { action: 'available' } };
    case 'which': {
      const target = args[0];
      return (
        positional(1) ?? {
          kind: 'engine',
          sub: target === undefined ? { action: 'which' } : { action: 'which', target },
        }
      );
    }
    case 'install': {
      const source = args[0];
      if (source === undefined) {
        return { kind: 'error', message: 'bunmaska engine install: missing <id|path>' };
      }
      return positional(1) ?? { kind: 'engine', sub: { action: 'install', source } };
    }
    case 'use': {
      const id = args[0];
      if (id === undefined) {
        return { kind: 'error', message: 'bunmaska engine use: missing <engine-id>' };
      }
      if (id.startsWith('-')) {
        return { kind: 'error', message: `bunmaska engine use: unexpected argument ${id}` };
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
    case 'prune': {
      // A typo such as --dryrun must not fall through to a real prune.
      const bad = args.find((arg) => arg !== '--dry-run' && arg !== '--force');
      if (bad !== undefined) {
        return { kind: 'error', message: `bunmaska engine prune: unexpected argument ${bad}` };
      }
      return {
        kind: 'engine',
        sub: {
          action: 'prune',
          dryRun: args.includes('--dry-run'),
          force: args.includes('--force'),
        },
      };
    }
    case 'verify': {
      const id = args[0];
      if (id === undefined) {
        return { kind: 'error', message: 'bunmaska engine verify: missing <engine-id>' };
      }
      return positional(1) ?? { kind: 'engine', sub: { action: 'verify', id } };
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
  // `bunmaska build --help` prints the usage instead of "unknown flag"; the
  // arguments after a run entry belong to the app.
  const own = head === 'run' ? rest.slice(0, 1) : rest;
  if (own.includes('--help') || own.includes('-h')) {
    return { kind: 'help' };
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
  if (head === 'keygen') {
    return parseKeygen(rest);
  }
  if (head === 'doctor') {
    const target = rest[0];
    return (
      unexpected('doctor', rest, 1) ??
      (target === undefined ? { kind: 'doctor' } : { kind: 'doctor', target })
    );
  }
  return { kind: 'error', message: `bunmaska: unknown command '${head}'` };
};

/**
 * `--target` when given, else the host platform. The platform tags and the
 * build-target tags coincide, so the host maps straight through.
 */
export const resolveTarget = (target: BuildTarget | undefined): BuildTarget =>
  target ?? currentPlatform();
