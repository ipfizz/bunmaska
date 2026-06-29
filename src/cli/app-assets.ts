import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import {
  defaultPreloadBundler,
  type PreloadBundler,
  usesModuleSyntax,
} from '../common/preload-bundle';

const COMPILED_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/**
 * Whether a sibling of the entry ships as a runtime asset rather than being
 * compiled into the binary. TypeScript sources, dotfiles and `node_modules` are
 * excluded; HTML, JS preloads, CSS, images, JSON and the like are kept.
 */
export const isRuntimeAsset = (name: string): boolean =>
  name !== 'node_modules' &&
  !name.startsWith('.') &&
  !COMPILED_SOURCE_EXTENSIONS.has(extname(name).toLowerCase());

/**
 * Copy the entry's sibling runtime assets into `destination` — the directory of
 * the compiled executable — so the app resolves them next to itself at launch.
 * The build output is skipped, so a destination nested under the entry's
 * directory is never copied into itself. Returns the names copied.
 */
export const copyAppAssets = (entry: string, destination: string): string[] => {
  const source = dirname(entry);
  if (!existsSync(source)) {
    return [];
  }
  const resolvedDestination = resolve(destination);
  const copied: string[] = [];
  for (const name of readdirSync(source)) {
    if (!isRuntimeAsset(name)) {
      continue;
    }
    const from = resolve(source, name);
    if (resolvedDestination === from || resolvedDestination.startsWith(`${from}${sep}`)) {
      continue;
    }
    cpSync(from, join(destination, name), { recursive: true });
    copied.push(name);
  }
  return copied;
};

/** Shipped asset names treated as the renderer preload, by convention. */
const PRELOAD_ASSET = /^preload\.(?:js|mjs|cjs)$/i;

/**
 * Bundle any shipped `preload.*` asset that uses `import`/`export` into a
 * self-contained classic script, in place, so a packaged app's preload runs the
 * same as it does under `bunmaska dev` — a preload is injected as a CLASSIC script
 * (no module mode), so a raw `import` would throw and silently kill `window.api`.
 * Plain preloads are left untouched. `names` is typically the {@link copyAppAssets}
 * return value. Returns the names rewritten.
 */
export const bundlePreloadAssets = (
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
    writeFileSync(path, bundler.bundle(resolve(path)));
    rewritten.push(name);
  }
  return rewritten;
};
