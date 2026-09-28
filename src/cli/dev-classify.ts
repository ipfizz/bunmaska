/** How `bunmaska dev` reacts to a changed path: restart, rebuild, reload or ignore. */

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { BunmaskaRendererConfig } from '../common/config-schema';
import { isIgnoredPath, pathParts } from './dev-watch';

/** TypeScript is compiled into the main process, so a change there restarts it. */
const MAIN_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** The preload is bundled once, at window construction: a reload re-injects the stale script. */
const PRELOAD_BASENAME = /^preload\.(?:js|mjs|cjs|ts)$/i;

export type ChangeAction = 'restart' | 'rebuild' | 'reload' | 'ignore';

/**
 * Classify a root-relative changed path. Under `rendererRoot` (the renderer
 * entry's directory) an edit rebuilds, and the bundle's writes then reload.
 */
export const classifyChange = (relPath: string, rendererRoot?: string): ChangeAction => {
  if (isIgnoredPath(relPath)) {
    return 'ignore';
  }
  const parts = pathParts(relPath);
  const base = parts[parts.length - 1] ?? '';
  if (PRELOAD_BASENAME.test(base)) {
    return 'restart';
  }
  if (rendererRoot !== undefined && isWithin(parts, pathParts(rendererRoot))) {
    return 'rebuild';
  }
  return MAIN_SOURCE_EXTENSIONS.has(extname(base).toLowerCase()) ? 'restart' : 'reload';
};

/** True when `parts` lies strictly under `root` (or is it, with `orSelf`). */
const isWithin = (parts: readonly string[], root: readonly string[], orSelf = false): boolean =>
  root.length > 0 &&
  root.length <= parts.length - (orSelf ? 0 : 1) &&
  root.every((part, i) => parts[i] === part);

/**
 * {@link classifyChange} for a project: a `renderer.copy` source rebuilds (its
 * dist copy then reloads, or restarts for a preload), and a module the entry
 * imports restarts wherever it lives.
 */
export const devClassifier = (
  dir: string,
  entry: string,
  renderer?: BunmaskaRendererConfig,
): ((relPath: string) => ChangeAction) => {
  const rendererRoot = renderer === undefined ? undefined : dirname(renderer.entry);
  const copies = (renderer?.copy ?? []).map(pathParts);
  let main = mainModules(dir, entry);
  return (relPath) => {
    const action = classifyChange(relPath, rendererRoot);
    if (action === 'ignore') {
      return action;
    }
    const parts = pathParts(relPath);
    if (copies.some((source) => isWithin(parts, source, true))) {
      return 'rebuild';
    }
    if (main.has(parts.join('/'))) {
      // The edit may add an import.
      main = mainModules(dir, entry);
      return 'restart';
    }
    return action;
  };
};

const SCRIPT_FILE = /\.[cm]?[jt]sx?$/i;

/**
 * Root-relative paths of `entry` and every local module it imports, transitively.
 * Only `./`, `../` and absolute specifiers are followed, so resolving never
 * reaches the package manager.
 */
const mainModules = (dir: string, entry: string): Set<string> => {
  const found = new Set<string>();
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    return found;
  }
  const visit = (file: string): void => {
    const rel = relative(root, file).split(sep).join('/');
    if (found.has(rel) || rel.startsWith('..') || isAbsolute(rel) || isIgnoredPath(rel)) {
      return;
    }
    found.add(rel);
    if (!SCRIPT_FILE.test(file)) {
      return;
    }
    let imports: readonly { readonly path: string }[];
    try {
      const loader = /x$/i.test(file) ? 'tsx' : 'ts';
      imports = new Bun.Transpiler({ loader }).scanImports(readFileSync(file, 'utf8'));
    } catch {
      return;
    }
    for (const { path } of imports) {
      if (/^\.{0,2}\//.test(path)) {
        try {
          visit(Bun.resolveSync(path, dirname(file)));
        } catch {
          // A missing local module is not a main module yet.
        }
      }
    }
  };
  try {
    visit(realpathSync(resolve(dir, entry)));
  } catch {
    // No entry file: nothing to follow.
  }
  return found;
};
