/**
 * `sambar.config.ts` loader for the CLI.
 *
 * A Sambar project may drop a `sambar.config.ts` (or `.js`/`.mjs`) at its root
 * to declare the app's name, bundle id, entry, icon and update feed once,
 * instead of repeating `sambar build` flags. `sambar init`/`dev`/`build` all
 * read it. Validation is pure (so it is unit-testable without touching disk);
 * the dynamic-import I/O is isolated in {@link loadConfigFile}.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { InvalidArgumentError } from '../common/errors';
import { type Channel, DEFAULT_CHANNEL } from '../common/manifest';

/** Auto-update feed configuration. */
export type SambarUpdatesConfig = {
  /** Base URL of the channel feed (where `update.json` + artifacts are served). */
  readonly url?: string;
  /** Release channel name. Defaults to `stable`. */
  readonly channel?: Channel;
};

/** A project's `sambar.config` shape. Every field is optional. */
export type SambarConfig = {
  /** Display/bundle name. */
  readonly name?: string;
  /** Bundle identifier (reverse-DNS, e.g. `com.example.app`). */
  readonly id?: string;
  /** The main-process entry file, relative to the project root. */
  readonly entry?: string;
  /** App icon path — a `.icns`/`.png` on macOS, a `.png` on Linux. */
  readonly icon?: string;
  /** Auto-update feed configuration. */
  readonly updates?: SambarUpdatesConfig;
};

/** The config file names searched for, in priority order. */
export const CONFIG_FILE_NAMES: readonly string[] = [
  'sambar.config.ts',
  'sambar.config.js',
  'sambar.config.mjs',
];

/**
 * Identity helper giving config authors type-checking and editor completion:
 * `export default defineConfig({ name: 'My App' })`.
 */
export const defineConfig = (config: SambarConfig): SambarConfig => config;

const assertOptionalString = (
  value: unknown,
  field: string,
  source: string,
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new InvalidArgumentError(`${source}: "${field}" must be a string`);
  }
  return value;
};

/**
 * Validate an untrusted, freshly-imported config value into a {@link SambarConfig}.
 * Pure — never reads disk. Throws {@link InvalidArgumentError} naming the bad
 * field. `source` labels the file in error messages.
 */
export const validateConfig = (raw: unknown, source = 'sambar.config'): SambarConfig => {
  if (raw === null || typeof raw !== 'object') {
    throw new InvalidArgumentError(`${source}: config must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const config: { -readonly [K in keyof SambarConfig]: SambarConfig[K] } = {};

  const name = assertOptionalString(record['name'], 'name', source);
  if (name !== undefined) {
    config.name = name;
  }
  const id = assertOptionalString(record['id'], 'id', source);
  if (id !== undefined) {
    config.id = id;
  }
  const entry = assertOptionalString(record['entry'], 'entry', source);
  if (entry !== undefined) {
    config.entry = entry;
  }
  const icon = assertOptionalString(record['icon'], 'icon', source);
  if (icon !== undefined) {
    config.icon = icon;
  }

  const updates = record['updates'];
  if (updates !== undefined) {
    if (updates === null || typeof updates !== 'object') {
      throw new InvalidArgumentError(`${source}: "updates" must be an object`);
    }
    const updatesRecord = updates as Record<string, unknown>;
    const url = assertOptionalString(updatesRecord['url'], 'updates.url', source);
    const channel = assertOptionalString(updatesRecord['channel'], 'updates.channel', source);
    config.updates = {
      ...(url !== undefined ? { url } : {}),
      ...(channel !== undefined ? { channel } : {}),
    };
  }

  return config;
};

/** The release channel a config selects, falling back to the default. */
export const configChannel = (config: SambarConfig): Channel =>
  config.updates?.channel ?? DEFAULT_CHANNEL;

/**
 * Find the project's config file under `cwd`, or `undefined` if none exists.
 * Returns an absolute path. The first name in {@link CONFIG_FILE_NAMES} wins.
 */
export const findConfigFile = (cwd: string): string | undefined => {
  for (const fileName of CONFIG_FILE_NAMES) {
    const candidate = join(cwd, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

/**
 * Import and validate a single config file by path. Accepts a `default` export
 * or a named `config` export. Throws {@link InvalidArgumentError} if neither is
 * present or the value is malformed.
 */
export const loadConfigFile = async (path: string): Promise<SambarConfig> => {
  const absolute = isAbsolute(path) ? path : resolve(path);
  const module = (await import(absolute)) as Record<string, unknown>;
  const value = module['default'] ?? module['config'];
  if (value === undefined) {
    throw new InvalidArgumentError(`${path}: expected a default export (or a "config" export)`);
  }
  return validateConfig(value, path);
};

/**
 * Load the project config under `cwd`. Returns the (validated) config and the
 * file it came from, or an empty config with `configPath: undefined` when the
 * project has no config file.
 */
export const loadConfig = async (
  cwd: string = process.cwd(),
): Promise<{ readonly config: SambarConfig; readonly configPath: string | undefined }> => {
  const configPath = findConfigFile(cwd);
  if (configPath === undefined) {
    return { config: {}, configPath: undefined };
  }
  return { config: await loadConfigFile(configPath), configPath };
};
