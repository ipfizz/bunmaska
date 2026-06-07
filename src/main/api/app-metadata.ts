import { dirname, join } from 'node:path';

/**
 * Pure resolution of the consuming app's name and version.
 *
 * Electron derives `app.getName()`/`app.getVersion()` from the application's
 * `package.json`. Sambar does the same: it walks up from the main module's
 * directory to the nearest `package.json` and reads `productName`/`name`/
 * `version`. The file-reading is injected ({@link ManifestReader}) so the
 * walk-up logic unit-tests without touching disk; the `app` layer supplies a
 * real reader over `fs`.
 */

/** Default name when no `package.json` is found (matches no real app). */
export const DEFAULT_APP_NAME = 'sambar-app';
/** Default version when the manifest omits one. */
export const DEFAULT_APP_VERSION = '0.0.0';

/**
 * The fields Sambar reads from a `package.json`. Each is explicitly
 * `| undefined` (not merely optional) so a parsed manifest can set a key to
 * `undefined` under `exactOptionalPropertyTypes`.
 */
export type Manifest = {
  readonly name?: string | undefined;
  readonly productName?: string | undefined;
  readonly version?: string | undefined;
};

/** A located manifest plus the directory it lives in (the app root). */
export type FoundManifest = {
  readonly dir: string;
  readonly manifest: Manifest;
};

/** Reads a file's contents, or returns `undefined` if it does not exist. */
export type ManifestReader = (path: string) => string | undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Parse `package.json` contents into a {@link Manifest}; `undefined` if invalid. */
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
 * Walk up from `startDir` to the filesystem root, returning the first directory
 * containing a parseable `package.json`. A malformed manifest is skipped (the
 * walk continues upward). Returns `undefined` if none is found.
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

/**
 * The app name: an explicit override (from `app.setName`) wins, then the
 * manifest's `productName`, then its `name`, then {@link DEFAULT_APP_NAME}.
 */
export const resolveAppName = (manifest: Manifest | undefined, override?: string): string => {
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return manifest?.productName ?? manifest?.name ?? DEFAULT_APP_NAME;
};

/** The app version from the manifest, or {@link DEFAULT_APP_VERSION}. */
export const resolveAppVersion = (manifest: Manifest | undefined): string =>
  manifest?.version ?? DEFAULT_APP_VERSION;
