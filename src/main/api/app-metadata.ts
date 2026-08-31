import { dirname, join } from 'node:path';

/**
 * Resolution of the consuming app's name and version: walk up from the main
 * module's directory to the nearest `package.json`, as Electron does.
 */

export const DEFAULT_APP_NAME = 'bunmaska-app';
export const DEFAULT_APP_VERSION = '0.0.0';

/**
 * Each field is explicitly `| undefined` (not merely optional) so a parsed
 * manifest can set a key to `undefined` under `exactOptionalPropertyTypes`.
 */
export type Manifest = {
  readonly name?: string | undefined;
  readonly productName?: string | undefined;
  readonly version?: string | undefined;
};

export type FoundManifest = {
  readonly dir: string;
  readonly manifest: Manifest;
};

/** Returns `undefined` when the file does not exist. */
export type ManifestReader = (path: string) => string | undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const parseManifest = (contents: string): Manifest | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  return {
    name: asString(record['name']),
    productName: asString(record['productName']),
    version: asString(record['version']),
  };
};

/**
 * The first directory at or above `startDir` with a PARSEABLE `package.json`;
 * a malformed manifest is skipped and the walk continues upward.
 */
export const findManifest = (startDir: string, read: ManifestReader): FoundManifest | undefined => {
  let dir = startDir;
  for (;;) {
    const contents = read(join(dir, 'package.json'));
    if (contents !== undefined) {
      const manifest = parseManifest(contents);
      if (manifest !== undefined) {
        return { dir, manifest };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
};

/** Precedence: `override`, `productName`, `name`, {@link DEFAULT_APP_NAME}. */
export const resolveAppName = (manifest: Manifest | undefined, override?: string): string => {
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return manifest?.productName ?? manifest?.name ?? DEFAULT_APP_NAME;
};

/** The app version from the manifest, or {@link DEFAULT_APP_VERSION}. */
export const resolveAppVersion = (manifest: Manifest | undefined): string =>
  manifest?.version ?? DEFAULT_APP_VERSION;
