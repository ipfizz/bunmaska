/**
 * The `bunmaska.config` schema. Keep it free of `node:fs` so a project's config
 * never drags the CLI loader into the app's runtime bundle.
 */

import { isSystemEngine, parseEngineId } from './engine-id';
import { InvalidArgumentError } from './errors';
import { type Channel, DEFAULT_CHANNEL } from './manifest';

export type BunmaskaUpdatesConfig = {
  /** Base URL of the channel feed (where `update.json` + artifacts are served). */
  readonly url?: string;
  /** Release channel name. Defaults to `stable`. */
  readonly channel?: Channel;
};

/** A self-hosted engine feed; the default feed and its key are baked in (D041, D042). */
export type BunmaskaEngineFeedConfig = {
  /** Base URL of the feed serving signed `.tar.zst` engines. */
  readonly url?: string;
  /** PEM public key that verifies this feed's engines (self-hosted feeds only). */
  readonly publicKey?: string;
};

/** The pinned-WebKit engine: the ONLY engine knob a user configures (D041). */
export type BunmaskaEngineConfig = {
  /**
   * A full engine-id (`webkitgtk-6.0-2.52.4-bunmaska1-linux-x64`), `system` (the
   * default: the OS WebView), or a bare upstream version (`2.52.4`), which builds
   * do not resolve yet and bake as `system` with a warning.
   */
  readonly webkit?: string;
  /** Copy the pinned engine into the bundle for offline/airgapped installs. */
  readonly embed?: boolean;
  /** A self-hosted engine feed (advanced). */
  readonly feed?: BunmaskaEngineFeedConfig;
};

/**
 * The renderer build Bunmaska owns: `bunmaska dev` rebuilds and live-reloads it,
 * `bunmaska build` ships it beside the executable. Always a classic IIFE, because
 * `file://` blocks ES modules (RENDERER-BUILD.md).
 */
export type BunmaskaRendererConfig = {
  /** The renderer entry (e.g. `src/renderer/main.tsx`), relative to the project root. */
  readonly entry: string;
  /** Output directory, relative to the project root. Defaults to `dist/renderer`. */
  readonly outDir?: string;
  /** Static files copied into `outDir` verbatim, relative to the project root. */
  readonly copy?: readonly string[];
};

/** A project's `bunmaska.config` shape. Every field is optional. */
export type BunmaskaConfig = {
  readonly name?: string;
  /** Bundle identifier (reverse-DNS, e.g. `com.example.app`). */
  readonly id?: string;
  /** The main-process entry file, relative to the project root. */
  readonly entry?: string;
  /** App icon path: a `.icns`/`.png` on macOS, a `.png` on Linux. */
  readonly icon?: string;
  readonly updates?: BunmaskaUpdatesConfig;
  /** Pinned-WebKit engine configuration (defaults to the system WebView). */
  readonly engine?: BunmaskaEngineConfig;
  /** The renderer build Bunmaska owns (optional; apps with their own bundler skip it). */
  readonly renderer?: BunmaskaRendererConfig;
};

/** The config file names searched for, in priority order. */
export const CONFIG_FILE_NAMES: readonly string[] = [
  'bunmaska.config.ts',
  'bunmaska.config.js',
  'bunmaska.config.mjs',
];

/** Identity helper giving config authors type-checking and editor completion. */
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

/** An object with only `known` keys, so a typo fails instead of being ignored. */
const assertObject = (
  value: unknown,
  field: string,
  known: readonly string[],
  source: string,
): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidArgumentError(
      `${source}: ${field === '' ? 'config' : `"${field}"`} must be an object`,
    );
  }
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      const path = field === '' ? key : `${field}.${key}`;
      throw new InvalidArgumentError(
        `${source}: unknown key "${path}" (known: ${known.join(', ')})`,
      );
    }
  }
  return value as Record<string, unknown>;
};

const isEnginePin = (pin: string): boolean => {
  if (isSystemEngine(pin) || /^\d+(?:\.\d+)+$/.test(pin)) {
    return true;
  }
  try {
    parseEngineId(pin);
    return true;
  } catch {
    return false;
  }
};

/** Validate an imported config; the {@link InvalidArgumentError} names `source` and the field. */
export const validateConfig = (raw: unknown, source = 'bunmaska.config'): BunmaskaConfig => {
  const record = assertObject(
    raw,
    '',
    ['name', 'id', 'entry', 'icon', 'updates', 'engine', 'renderer'],
    source,
  );
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
    const updatesRecord = assertObject(updates, 'updates', ['url', 'channel'], source);
    const url = assertOptionalString(updatesRecord['url'], 'updates.url', source);
    const channel = assertOptionalString(updatesRecord['channel'], 'updates.channel', source);
    config.updates = {
      ...(url !== undefined ? { url } : {}),
      ...(channel !== undefined ? { channel } : {}),
    };
  }

  const engine = record['engine'];
  if (engine !== undefined) {
    const engineRecord = assertObject(engine, 'engine', ['webkit', 'embed', 'feed'], source);
    const webkit = assertOptionalString(engineRecord['webkit'], 'engine.webkit', source);
    if (webkit !== undefined && !isEnginePin(webkit)) {
      throw new InvalidArgumentError(
        `${source}: "engine.webkit" must be "system", an upstream version (2.52.4) or a full engine id (webkitgtk-6.0-2.52.4-bunmaska1-linux-x64), got ${JSON.stringify(webkit)}`,
      );
    }
    const embed = assertOptionalBoolean(engineRecord['embed'], 'engine.embed', source);

    const feedRaw = engineRecord['feed'];
    let feed: BunmaskaEngineFeedConfig | undefined;
    if (feedRaw !== undefined) {
      const feedRecord = assertObject(feedRaw, 'engine.feed', ['url', 'publicKey'], source);
      const url = assertOptionalString(feedRecord['url'], 'engine.feed.url', source);
      const publicKey = assertOptionalString(
        feedRecord['publicKey'],
        'engine.feed.publicKey',
        source,
      );
      feed = {
        ...(url !== undefined ? { url } : {}),
        ...(publicKey !== undefined ? { publicKey } : {}),
      };
    }

    config.engine = {
      ...(webkit !== undefined ? { webkit } : {}),
      ...(embed !== undefined ? { embed } : {}),
      ...(feed !== undefined ? { feed } : {}),
    };
  }

  const renderer = record['renderer'];
  if (renderer !== undefined) {
    const rendererRecord = assertObject(renderer, 'renderer', ['entry', 'outDir', 'copy'], source);
    const entry = assertOptionalString(rendererRecord['entry'], 'renderer.entry', source);
    if (entry === undefined) {
      throw new InvalidArgumentError(
        `${source}: "renderer.entry" is required when "renderer" is set`,
      );
    }
    const outDir = assertOptionalString(rendererRecord['outDir'], 'renderer.outDir', source);
    const copyRaw = rendererRecord['copy'];
    let copy: readonly string[] | undefined;
    if (copyRaw !== undefined) {
      if (!Array.isArray(copyRaw) || copyRaw.some((entryPath) => typeof entryPath !== 'string')) {
        throw new InvalidArgumentError(`${source}: "renderer.copy" must be an array of strings`);
      }
      copy = copyRaw as string[];
    }
    config.renderer = {
      entry,
      ...(outDir !== undefined ? { outDir } : {}),
      ...(copy !== undefined ? { copy } : {}),
    };
  }

  return config;
};

/** The renderer output directory a config selects, or the default. */
export const rendererOutDir = (renderer: BunmaskaRendererConfig): string =>
  renderer.outDir ?? 'dist/renderer';

/** The release channel a config selects, falling back to the default. */
export const configChannel = (config: BunmaskaConfig): Channel =>
  config.updates?.channel ?? DEFAULT_CHANNEL;
