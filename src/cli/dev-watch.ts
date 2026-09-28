/** The `bunmaska dev` file watcher: which paths count, and which events are real edits. */

import { type Dirent, readdirSync, readFileSync, statSync, watch as fsWatch } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Top-level output dirs of common tools. `dist` is deliberately NOT here: the
 * renderer bundle lives there, and ignoring it means a rebuild never reloads.
 */
const IGNORED_ROOT_DIRS: ReadonlySet<string> = new Set(['build', 'out', 'coverage']);

/**
 * Dependencies, dot directories (VCS, editor state), `.app` bundles `bunmaska build`
 * writes into the root, and the root output dirs.
 * ponytail: a Linux or Windows build writes a bare `<Name>/` into the root, which
 * stays watched; `--out` outside the root avoids the churn.
 */
const isIgnoredSegment = (name: string, depth: number): boolean =>
  name === 'node_modules' ||
  name.startsWith('.') ||
  name.endsWith('.app') ||
  (depth === 0 && IGNORED_ROOT_DIRS.has(name));

/** Split a watcher or config path on either separator, dropping `.` segments. */
export const pathParts = (relPath: string): string[] =>
  relPath.split(/[\\/]/).filter((p) => p.length > 0 && p !== '.');

/** True for a path `bunmaska dev` never reacts to: ignored trees and dotfiles. */
export const isIgnoredPath = (relPath: string): boolean => {
  const parts = pathParts(relPath);
  return parts.length === 0 || parts.some(isIgnoredSegment);
};

/** The two content-comparison modes the watcher needs. Same seen-map underneath. */
export type ContentFilter = {
  /**
   * First sight passes (a newly created file is a real change); thereafter only
   * a byte change passes. A vanished file always passes (a deletion is real).
   */
  changed(relPath: string): boolean;
  /**
   * Strict: passes only for a path already seen whose bytes changed; an unseen
   * path is silently seeded. Used when rescanning a directory on an editor
   * temp-file event, where first-sight-passes would fire every untouched
   * sibling.
   */
  changedIfSeen(relPath: string): boolean;
};

/**
 * Drop events whose file content did not actually change. `fs.watch` fires on a
 * metadata-only touch, and a formatter that rewrites identical bytes fires too;
 * both would otherwise restart the app. `readFile` is a seam so this tests
 * without the filesystem.
 */
export const makeContentFilter = (
  readFile: (relPath: string) => string | undefined,
): ContentFilter => {
  const seen = new Map<string, string>();
  const hashOf = (relPath: string): string | undefined => {
    const contents = readFile(relPath);
    return contents === undefined ? undefined : String(Bun.hash(contents));
  };
  return {
    changed(relPath) {
      const hash = hashOf(relPath);
      if (hash === undefined) {
        seen.delete(relPath);
        return true;
      }
      if (seen.get(relPath) === hash) {
        return false;
      }
      seen.set(relPath, hash);
      return true;
    },
    changedIfSeen(relPath) {
      const hash = hashOf(relPath);
      if (hash === undefined) {
        seen.delete(relPath);
        return false;
      }
      const previous = seen.get(relPath);
      seen.set(relPath, hash);
      return previous !== undefined && previous !== hash;
    },
  };
};

/**
 * The parent directory of an editor temp-file event, or `undefined` when the
 * event is not one. An atomic save (write temp + rename) can coalesce under
 * FSEvents into a SINGLE event for the dot-named temp file (`.!1234!main.ts`
 * from BSD sed, swap files, etc.), so ignoring dot basenames outright loses the
 * save; the caller rescans this directory instead. Pure.
 */
export const editorTempDir = (relPath: string): string | undefined => {
  const parts = pathParts(relPath);
  const dirs = parts.slice(0, -1);
  const base = parts[parts.length - 1] ?? '';
  return base.startsWith('.') && !dirs.some(isIgnoredSegment) ? dirs.join('/') : undefined;
};

/** Files bigger than this are not hashed at seed time (first-sight then applies). */
const SEED_MAX_BYTES = 5_000_000;

/**
 * Hash every watchable file up front so the strict rescan mode has a baseline
 * from the first save of the session, not the second.
 */
const seedContentFilter = (root: string, filter: ContentFilter, relDir = ''): void => {
  let entries: Dirent[];
  try {
    entries = readdirSync(resolve(root, relDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    if (isIgnoredPath(rel)) {
      continue;
    }
    if (entry.isDirectory()) {
      seedContentFilter(root, filter, rel);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    try {
      if (statSync(resolve(root, rel)).size > SEED_MAX_BYTES) {
        continue;
      }
    } catch {
      continue;
    }
    filter.changedIfSeen(rel);
  }
};

/**
 * The `fs.watch` callback for `dir`: forwards each real edit to `onChange` as a
 * root-relative path. Seeds the content baseline when created.
 */
export const makeWatchHandler = (
  dir: string,
  onChange: (relPath: string) => void,
): ((filename: string | null) => void) => {
  const filter = makeContentFilter((relPath) => {
    try {
      return readFileSync(resolve(dir, relPath), 'utf8');
    } catch {
      return undefined;
    }
  });
  seedContentFilter(dir, filter);
  // An atomic save may surface only as its temp-file event; find what really
  // changed in that directory instead of dropping the save.
  const rescan = (relDir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(resolve(dir, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isFile() && !isIgnoredPath(rel) && filter.changedIfSeen(rel)) {
        onChange(rel);
      }
    }
  };
  return (filename) => {
    if (filename === null) {
      return;
    }
    const relPath = filename;
    const tempDir = editorTempDir(relPath);
    if (tempDir !== undefined) {
      rescan(tempDir);
      return;
    }
    // Classify before hashing so node_modules churn never costs a file read.
    if (isIgnoredPath(relPath) || !filter.changed(relPath)) {
      return;
    }
    onChange(relPath);
  };
};

/** Watch `dir` recursively; see {@link makeWatchHandler}. */
export const watchTree = (
  dir: string,
  onChange: (relPath: string) => void,
): { readonly close: () => void } => {
  const handle = makeWatchHandler(dir, onChange);
  const watcher = fsWatch(dir, { recursive: true }, (_event, filename) => {
    handle(filename === null ? null : filename.toString());
  });
  return {
    close: () => {
      watcher.close();
    },
  };
};
