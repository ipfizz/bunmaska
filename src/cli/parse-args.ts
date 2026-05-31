/**
 * Pure argument parser for the `sambar` CLI.
 *
 * Maps a raw argv tail (no node/bun/script prefix) to a {@link Command}
 * discriminated union. {@link parseArgs} does no I/O and never reads `process`,
 * so every branch is unit-testable. The lone exception is {@link resolveTarget},
 * which folds in the host platform default and is kept here beside its type.
 */

import { currentPlatform } from '../common/platform';

/** Build targets `sambar build` can produce. */
export type BuildTarget = 'macos' | 'linux';

/** Options accepted by `sambar build`. All optional; the bundler fills defaults. */
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
};

export type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'run'; readonly entry: string; readonly args: readonly string[] }
  | { readonly kind: 'build'; readonly entry: string; readonly options: BuildOptions }
  | { readonly kind: 'error'; readonly message: string };

/** `sambar build` flags that take a string value, keyed by argv token. */
const BUILD_STRING_FLAGS = new Map<string, 'name' | 'id' | 'out' | 'icon' | 'sign'>([
  ['--name', 'name'],
  ['--id', 'id'],
  ['--out', 'out'],
  ['--icon', 'icon'],
  ['--sign', 'sign'],
]);

/** `sambar build` boolean flags that take no value, by argv token. */
const BUILD_BOOLEAN_FLAGS: ReadonlySet<string> = new Set<string>(['--notarize', '--dmg']);

const BUILD_TARGETS: ReadonlySet<BuildTarget> = new Set<BuildTarget>(['macos', 'linux']);

const isBuildTarget = (value: string): value is BuildTarget =>
  BUILD_TARGETS.has(value as BuildTarget);

const parseRun = (rest: readonly string[]): Command => {
  const [entry, ...args] = rest;
  if (entry === undefined) {
    return { kind: 'error', message: 'sambar run: missing <entry.ts>' };
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
        }
        continue;
      }
      if (token === '--target') {
        const value = rest[i + 1];
        if (value === undefined) {
          return { kind: 'error', message: `sambar build: flag ${token} requires a value` };
        }
        if (!isBuildTarget(value)) {
          return {
            kind: 'error',
            message: `sambar build: --target must be macos or linux (got ${value})`,
          };
        }
        options.target = value;
        i += 1;
        continue;
      }
      const key = BUILD_STRING_FLAGS.get(token);
      if (key === undefined) {
        return { kind: 'error', message: `sambar build: unknown flag ${token}` };
      }
      const value = rest[i + 1];
      if (value === undefined) {
        return { kind: 'error', message: `sambar build: flag ${token} requires a value` };
      }
      options[key] = value;
      i += 1;
      continue;
    }
    if (entry === undefined) {
      entry = token;
      continue;
    }
    return { kind: 'error', message: `sambar build: unexpected argument ${token}` };
  }

  if (entry === undefined) {
    return { kind: 'error', message: 'sambar build: missing <entry.ts>' };
  }
  return { kind: 'build', entry, options };
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
  if (head === 'run') {
    return parseRun(rest);
  }
  if (head === 'build') {
    return parseBuild(rest);
  }
  return { kind: 'error', message: `sambar: unknown command '${head}'` };
};

/**
 * Resolve the effective build target: an explicit `--target` when given,
 * otherwise the host platform (macOS hosts build macOS, Linux hosts build Linux;
 * a macOS host can still cross-build Linux via `--target linux`).
 */
export const resolveTarget = (target: BuildTarget | undefined): BuildTarget => {
  if (target !== undefined) {
    return target;
  }
  const host = currentPlatform();
  return host === 'macos' ? 'macos' : 'linux';
};
