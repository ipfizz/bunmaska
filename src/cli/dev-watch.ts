/** The `bunmaska dev` file watcher: which paths count, and which events are real edits. */

import { type Dirent, readdirSync, readFileSync, statSync, watch as fsWatch } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Dependency, VCS and OUR-OWN-BUILD-OUTPUT directories. `dist` is deliberately NOT
 * here: an app's renderer bundle lives there, and ignoring it meant a rebuilt
 * bundle could never trigger a reload. The app bundles `bunmaska build` writes are
 * ignored by suffix instead, because it defaults its output to the project root.
 */
const IGNORED_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'build',
  'out',
  'coverage',
]);

/**
 * Directory suffixes `bunmaska build` produces inside the watched root.
 * ponytail: the Linux AppDir is a bare `<Name>/` with no suffix to match, so a
 * Linux build during `dev` still churns; `--out` outside the root avoids it.
 */
const IGNORED_SEGMENT_SUFFIXES: readonly string[] = ['.app', '.AppDir'];

const isIgnoredSegment = (p: string): boolean =>
  IGNORED_SEGMENTS.has(p) || IGNORED_SEGMENT_SUFFIXES.some((suffix) => p.endsWith(suffix));

/** Split a watcher path on either separator. */
export const pathParts = (relPath: string): string[] =>
  relPath.split(/[\\/]/).filter((p) => p.length > 0);

/** True for a path `bunmaska dev` never reacts to: ignored trees and dotfiles. */
export const isIgnoredPath = (relPath: string): boolean => {
  const parts = pathParts(relPath);
  const base = parts[parts.length - 1] ?? '';
  return parts.some(isIgnoredSegment) || base.length === 0 || base.startsWith('.');
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
  if (parts.length === 0 || parts.some(isIgnoredSegment)) {
    return undefined;
  }
  const base = parts[parts.length - 1] ?? '';
  if (!base.startsWith('.')) {
    return undefined;
  }
  return parts.slice(0, -1).join('/');
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
    const name = entry.name;
    if (name.startsWith('.')) {
      continue;
    }
    const rel = relDir === '' ? name : `${relDir}/${name}`;
    if (entry.isDirectory()) {
      if (!isIgnoredSegment(name)) {
        seedContentFilter(root, filter, rel);
      }
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
      if (!entry.isFile() || entry.name.startsWith('.')) {
        continue;
      }
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (!isIgnoredPath(rel) && filter.changedIfSeen(rel)) {
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
