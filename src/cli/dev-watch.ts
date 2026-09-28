/** The `bunmaska dev` file watcher: which paths count, and which events are real edits. */

import { type Dirent, readdirSync, readFileSync, statSync, watch as fsWatch } from 'node:fs';
import { resolve } from 'node:path';

/** The dev window-state file `bunmaska dev` keeps in the project root. */
export const DEV_STATE_FILE = '.bunmaska-dev-state.json';

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

/** Two views over one content-hash baseline. */
export type ContentFilter = {
  /** True for a new file, a byte change or a deletion. */
  changed(relPath: string): boolean;
  /**
   * True only for a seen path whose bytes changed; an unseen path is seeded
   * silently. Rescans need this: first-sight-passes would fire every sibling.
   */
  changedIfSeen(relPath: string): boolean;
};

/**
 * Drop events whose bytes did not change: `fs.watch` fires on a metadata-only
 * touch and on a formatter rewriting identical bytes, and both would restart the app.
 */
export const makeContentFilter = (
  readFile: (relPath: string) => Uint8Array | undefined,
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
 * The directory of an editor temp-file event, or `undefined` for any other path.
 * FSEvents can coalesce an atomic save (write temp, rename) into a SINGLE event
 * for the dot-named temp file (`.!1234!main.ts` from BSD sed), so dropping dot
 * basenames loses the save; the caller rescans this directory instead.
 */
export const editorTempDir = (relPath: string): string | undefined => {
  const parts = pathParts(relPath);
  const dirs = parts.slice(0, -1);
  const base = parts[parts.length - 1] ?? '';
  return base.startsWith('.') && !dirs.some(isIgnoredSegment) ? dirs.join('/') : undefined;
};

/** Files bigger than this are not seeded; their first event passes as first sight. */
const SEED_MAX_BYTES = 5_000_000;

/** Hash every watchable file up front, so a rescan has a baseline from the first save. */
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
      return readFileSync(resolve(dir, relPath));
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
    if (filename === null || filename === DEV_STATE_FILE) {
      return;
    }
    // One key per file: libuv reports Windows paths with backslashes, the seed uses slashes.
    const relPath = pathParts(filename).join('/');
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
  log: (message: string) => void,
): { readonly close: () => void } => {
  const handle = makeWatchHandler(dir, onChange);
  const watcher = fsWatch(dir, { recursive: true }, (_event, filename) => {
    handle(filename === null ? null : filename.toString());
  });
  // Unhandled, a watch error (inotify ENOSPC) kills the supervisor and orphans the app.
  watcher.on('error', (error) => {
    log(`file watching stopped (${error.message}); restart bunmaska dev`);
  });
  return {
    close: () => {
      watcher.close();
    },
  };
};
