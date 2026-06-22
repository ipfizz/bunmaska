import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';

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
