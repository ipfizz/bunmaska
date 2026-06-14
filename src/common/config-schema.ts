/**
 * The pure `bunmaska.config` schema: types, validation, and the `defineConfig`
 * helper, with no filesystem dependency. The CLI's loader (`src/cli/config.ts`)
 * layers file discovery and dynamic import on top of this; the public
 * `bunmaska/config` entry re-exports only this module, so a project's config file
 * never drags the loader's `node:fs` code into the app's runtime bundle.
 */

import { InvalidArgumentError } from './errors';
import { type Channel, DEFAULT_CHANNEL } from './manifest';

/** Auto-update feed configuration. */
export type BunmaskaUpdatesConfig = {
  /** Base URL of the channel feed (where `update.json` + artifacts are served). */
  readonly url?: string;
  /** Release channel name. Defaults to `stable`. */
  readonly channel?: Channel;
};

/** A project's `bunmaska.config` shape. Every field is optional. */
export type BunmaskaConfig = {
  /** Display/bundle name. */
  readonly name?: string;
  /** Bundle identifier (reverse-DNS, e.g. `com.example.app`). */
  readonly id?: string;
  /** The main-process entry file, relative to the project root. */
  readonly entry?: string;
  /** App icon path — a `.icns`/`.png` on macOS, a `.png` on Linux. */
  readonly icon?: string;
  /** Auto-update feed configuration. */
  readonly updates?: BunmaskaUpdatesConfig;
};

/** The config file names searched for, in priority order. */
export const CONFIG_FILE_NAMES: readonly string[] = [
  'bunmaska.config.ts',
  'bunmaska.config.js',
  'bunmaska.config.mjs',
];

/**
 * Identity helper giving config authors type-checking and editor completion:
 * `export default defineConfig({ name: 'My App' })`.
 */
export const defineConfig = (config: BunmaskaConfig): BunmaskaConfig => config;

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
 * Validate an untrusted, freshly-imported config value into a {@link BunmaskaConfig}.
 * Pure — never reads disk. Throws {@link InvalidArgumentError} naming the bad
 * field. `source` labels the file in error messages.
 */
export const validateConfig = (raw: unknown, source = 'bunmaska.config'): BunmaskaConfig => {
  if (raw === null || typeof raw !== 'object') {
    throw new InvalidArgumentError(`${source}: config must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const config: { -readonly [K in keyof BunmaskaConfig]: BunmaskaConfig[K] } = {};

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
export const configChannel = (config: BunmaskaConfig): Channel =>
  config.updates?.channel ?? DEFAULT_CHANNEL;
