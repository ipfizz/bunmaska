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

/**
 * Pinned-WebKit engine configuration — the "tested == shipped" knob. Many engine
 * versions coexist in the shared store; this declares which one THIS app pins.
 */
export type BunmaskaEngineConfig = {
  /**
   * The WebKit engine to pin: a full engine-id
   * (`webkitgtk-6.0-2.52.4-bunmaska1-linux-x64`), a bare upstream version
   * (`2.52.4`, resolved to the host's id at build time), or `system` (the
   * default — use the OS WebView, no pinning).
   */
  readonly webkit?: string;
  /** Copy the pinned engine into the bundle for offline/airgapped installs. */
  readonly embed?: boolean;
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
  /** Pinned-WebKit engine configuration (defaults to the system WebView). */
  readonly engine?: BunmaskaEngineConfig;
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

const assertOptionalBoolean = (
  value: unknown,
  field: string,
  source: string,
): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new InvalidArgumentError(`${source}: "${field}" must be a boolean`);
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

  const engine = record['engine'];
  if (engine !== undefined) {
    if (engine === null || typeof engine !== 'object') {
      throw new InvalidArgumentError(`${source}: "engine" must be an object`);
    }
    const engineRecord = engine as Record<string, unknown>;
    const webkit = assertOptionalString(engineRecord['webkit'], 'engine.webkit', source);
    const embed = assertOptionalBoolean(engineRecord['embed'], 'engine.embed', source);
    config.engine = {
      ...(webkit !== undefined ? { webkit } : {}),
      ...(embed !== undefined ? { embed } : {}),
    };
  }

  return config;
};

/** The release channel a config selects, falling back to the default. */
export const configChannel = (config: BunmaskaConfig): Channel =>
  config.updates?.channel ?? DEFAULT_CHANNEL;
