import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import {
  defaultPreloadBundler,
  type PreloadBundler,
  usesModuleSyntax,
} from '../common/preload-bundle';
import { findManifest } from '../main/api/app-metadata';

// An allowlist, not a denylist: the entry's directory can hold the update-signing key.
const RUNTIME_ASSET_EXTENSIONS = new Set(
  (
    '.html .htm .js .mjs .cjs .css .json .wasm .txt ' +
    '.png .jpg .jpeg .gif .svg .webp .avif .ico .icns .bmp .woff .woff2 .ttf .otf ' +
    '.mp3 .mp4 .m4a .aac .wav .ogg .webm .flac .dylib .so .dll'
  ).split(' '),
);

/** Whether a file of this name ships beside the executable. */
export const isRuntimeAsset = (name: string): boolean =>
  RUNTIME_ASSET_EXTENSIONS.has(extname(name).toLowerCase());

const shipsAsAsset = (path: string): boolean => {
  const name = basename(path);
  if (name.startsWith('.') || name === 'node_modules') {
    return false;
  }
  return statSync(path).isDirectory() || isRuntimeAsset(name);
};

/**
 * Copy the entry's allowlisted sibling assets (recursively) beside the executable.
 * The build output is skipped, so a destination under the entry dir never copies into itself.
 */
export const copyAppAssets = (entry: string, destination: string): string[] => {
  const source = dirname(entry);
  if (!existsSync(source)) {
    return [];
  }
  const resolvedDestination = resolve(destination);
  const copied: string[] = [];
  for (const name of readdirSync(source)) {
    const from = resolve(source, name);
    if (resolvedDestination === from || resolvedDestination.startsWith(`${from}${sep}`)) {
      continue;
    }
    if (!shipsAsAsset(from)) {
      continue;
    }
    cpSync(from, join(destination, name), { recursive: true, filter: shipsAsAsset });
    copied.push(name);
  }
  return copied;
};

const readIfPresent = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined;

/**
 * The runtime reads a compiled app's name and version only from `package.json` beside it. The
 * name is the one dev reads from the entry's project (so `userData` stays put), else `name`.
 */
export const writeAppManifest = (
  destination: string,
  entry: string,
  name: string,
  version: string,
): void => {
  const project = findManifest(dirname(resolve(entry)), readIfPresent)?.manifest;
  const named = project?.productName !== undefined || project?.name !== undefined;
  const manifest = named
    ? { name: project?.name, productName: project?.productName, version }
    : { productName: name, version };
  writeFileSync(join(destination, 'package.json'), `${JSON.stringify(manifest)}\n`);
};

const PRELOAD_ASSET = /^preload\.(?:js|mjs|cjs)$/i;

/**
 * Bundle each shipped module-syntax `preload.*` into a classic IIFE in place
 * (D046: a compiled app cannot bundle at runtime). Returns the names rewritten.
 */
export const bundlePreloadAssets = (
  entry: string,
  destination: string,
  names: readonly string[],
  bundler: PreloadBundler = defaultPreloadBundler,
): string[] => {
  const rewritten: string[] = [];
  for (const name of names) {
    if (!PRELOAD_ASSET.test(name)) {
      continue;
    }
    const path = join(destination, name);
    if (!usesModuleSyntax(readFileSync(path, 'utf8'))) {
      continue;
    }
    // Bundle the source, not the copy: its imports (e.g. `.ts` helpers) resolve only there.
    writeFileSync(path, bundler.bundle(resolve(dirname(entry), name)));
    rewritten.push(name);
  }
  return rewritten;
};
