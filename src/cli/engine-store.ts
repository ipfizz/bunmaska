/**
 * Content-addressed engine store: many WebKit versions live side by side under
 * `~/.bunmaska/webkit/<engine-id>/` and each app resolves the exact id it was
 * built against — there is no global "current" engine. A store dir is kept iff
 * some installed app (a `.links/*` refcount entry) still needs it. A fully
 * installed engine is the one with an `INSTALLATION_COMPLETE` marker, written
 * LAST after the content hash verifies — a half-download has no marker and is
 * re-fetched.
 */

import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { BunmaskaError } from '../common/errors';
import { contentHash } from '../common/manifest';

export const INSTALLATION_COMPLETE = 'INSTALLATION_COMPLETE';
const LINKS_DIR = '.links';
const LOCK_FILE = '__dirlock';
const STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 10_000;

export type StoreEnv = Record<string, string | undefined>;

const defaultHome = (env: StoreEnv): string =>
  env['BUNMASKA_HOME'] ?? join(env['HOME'] ?? env['USERPROFILE'] ?? homedir(), '.bunmaska');

/**
 * `$BUNMASKA_ENGINES_PATH`, else `<home>/webkit`. The single env-reading
 * function; every other op takes an explicit `root`.
 */
export const enginesPath = (env: StoreEnv = process.env): string =>
  env['BUNMASKA_ENGINES_PATH'] ?? join(defaultHome(env), 'webkit');

/**
 * Reject an engine id that is not a single, contained directory segment under
 * `root`. An id reaches the store from an untrusted source — a remote feed
 * manifest (`engine-remote.ts`) or an `engine.json` — and is used verbatim to
 * build a directory that install then `rm`s and `rename`s over. Without this an
 * id like `../../x` or an absolute path is a traversal + arbitrary-delete. Bars
 * separators, absolute paths, `.`/`..`, and anything resolving outside `root`.
 */
export const assertSafeEngineId = (root: string, id: string): void => {
  const base = resolve(root);
  const dir = resolve(base, id);
  const unsafe =
    id.length === 0 ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    id.startsWith('.') || // .links, .tmp-*, dotfiles — reserved store internals
    id === LOCK_FILE ||
    id === INSTALLATION_COMPLETE ||
    isAbsolute(id) ||
    !dir.startsWith(base + sep);
  if (unsafe) {
    throw new BunmaskaError(`engine store: refusing unsafe engine id ${JSON.stringify(id)}`, {
      code: 'ERR_ENGINE_ID',
    });
  }
};

export const engineDir = (root: string, id: string): string => join(root, id);

export const markerPath = (root: string, id: string): string =>
  join(root, id, INSTALLATION_COMPLETE);

export const linkPath = (root: string, appPath: string): string =>
  join(root, LINKS_DIR, createHash('sha1').update(appPath).digest('hex'));

export const lockPath = (root: string): string => join(root, LOCK_FILE);

export const isInstalled = (root: string, id: string): boolean => existsSync(markerPath(root, id));

/** The installed (marker-complete) engine ids in the store, sorted. */
export const listInstalled = (root: string): string[] => {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((name) => isInstalled(root, name))
    .sort();
};

/** A refcount entry: which engine id an installed app needs. */
export type EngineLink = { readonly app: string; readonly engine: string };

/** Register an installed app as needing `engineId` (a refcount entry). */
export const linkApp = (root: string, appPath: string, engineId: string): void => {
  mkdirSync(join(root, LINKS_DIR), { recursive: true });
  writeFileSync(linkPath(root, appPath), JSON.stringify({ app: appPath, engine: engineId }));
};

export const unlinkApp = (root: string, appPath: string): void => {
  rmSync(linkPath(root, appPath), { force: true });
};

/** Read every refcount entry. Malformed entries are skipped. */
export const readLinks = (root: string): EngineLink[] => {
  const dir = join(root, LINKS_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  const links: EngineLink[] = [];
  for (const name of readdirSync(dir)) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Partial<EngineLink>;
      if (typeof raw.app === 'string' && typeof raw.engine === 'string') {
        links.push({ app: raw.app, engine: raw.engine });
      }
    } catch {
      // Skip an unreadable/corrupt link entry rather than failing GC.
    }
  }
  return links;
};

export type InstallSource = {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly expectedHash: string;
};

export type InstallDeps = {
  /** Populate `destDir` with the engine tree (`lib/`, `engine.json`) from the bytes. */
  readonly extract: (bytes: Uint8Array, destDir: string) => Promise<void>;
  /** Fired immediately after the marker is written. */
  readonly onMarker?: () => void;
};

export type InstallResult = { readonly id: string; readonly installed: boolean };

/**
 * Idempotent: a fully-installed id is left untouched. The marker is written
 * LAST, after the hash verifies and the staging dir is swapped in. A hash
 * mismatch throws and leaves no engine dir behind.
 */
export const installFromSource = async (
  root: string,
  source: InstallSource,
  deps: InstallDeps,
): Promise<InstallResult> => {
  assertSafeEngineId(root, source.id);
  if (isInstalled(root, source.id)) {
    return { id: source.id, installed: false };
  }
  const actual = contentHash(source.bytes);
  if (actual !== source.expectedHash) {
    throw new BunmaskaError(
      `engine ${source.id}: integrity check failed — hash ${actual} != expected ${source.expectedHash}`,
      { code: 'ERR_ENGINE_INTEGRITY' },
    );
  }
  mkdirSync(root, { recursive: true });
  const staging = mkdtempSync(join(root, '.tmp-'));
  try {
    await deps.extract(source.bytes, staging);
    // Bind the store dir to the SIGNED engine.json inside the artifact: the .sig
    // covers the bytes, not the claimed id, so without this a genuinely-signed
    // older/other engine could install under a different pinned id (downgrade).
    const extracted = readEngineManifest(staging);
    if (extracted.id !== source.id) {
      throw new BunmaskaError(
        `engine ${source.id}: signed engine.json declares a different id ${JSON.stringify(extracted.id)}`,
        { code: 'ERR_ENGINE_INTEGRITY' },
      );
    }
    // Swap-into-place + marker under the store lock so a concurrent install or gc
    // in another process can't race the rename (extract already ran on a private
    // staging dir, so the slow part is NOT inside the lock).
    return await withLock(root, async () => {
      if (isInstalled(root, source.id)) {
        rmSync(staging, { recursive: true, force: true });
        return { id: source.id, installed: false };
      }
      const dest = engineDir(root, source.id);
      rmSync(dest, { recursive: true, force: true }); // clear any partial prior install
      renameSync(staging, dest);
      writeFileSync(markerPath(root, source.id), `${new Date().toISOString()}\n`);
      deps.onMarker?.();
      return { id: source.id, installed: true };
    });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
};

/** The `engine.json` manifest shipped inside every engine dir. */
export type EngineManifest = {
  readonly id: string;
  readonly soname: string;
  readonly hash?: string;
  readonly size?: number;
};

/** Read + validate an engine's `engine.json` from a dir. Throws if missing/invalid. */
export const readEngineManifest = (dir: string): EngineManifest => {
  let raw: unknown;
  try {
    // strip a UTF-8 BOM — Windows tooling (PowerShell 5.1) writes one
    raw = JSON.parse(readFileSync(join(dir, 'engine.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new BunmaskaError(`engine: no readable engine.json in ${dir}`, {
      code: 'ERR_ENGINE_MANIFEST',
    });
  }
  const record = (raw ?? {}) as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || typeof record['soname'] !== 'string') {
    throw new BunmaskaError(`engine: engine.json in ${dir} must have string "id" and "soname"`, {
      code: 'ERR_ENGINE_MANIFEST',
    });
  }
  return {
    id: record['id'],
    soname: record['soname'],
    ...(typeof record['hash'] === 'string' ? { hash: record['hash'] } : {}),
    ...(typeof record['size'] === 'number' ? { size: record['size'] } : {}),
  };
};

/**
 * Install from a local, already-extracted engine tree (`lib/` + `engine.json`).
 * Idempotent, marker written last. Signed remote installs go through
 * {@link ../cli/engine-remote installFromUrl} instead.
 */
export const installFromDir = async (
  root: string,
  sourceDir: string,
  deps: { readonly copyTree?: (from: string, to: string) => void } = {},
): Promise<InstallResult> => {
  const manifest = readEngineManifest(sourceDir);
  assertSafeEngineId(root, manifest.id);
  if (isInstalled(root, manifest.id)) {
    return { id: manifest.id, installed: false };
  }
  const copyTree = deps.copyTree ?? ((from, to) => cpSync(from, to, { recursive: true }));
  mkdirSync(root, { recursive: true });
  const staging = mkdtempSync(join(root, '.tmp-'));
  try {
    copyTree(sourceDir, staging);
    return await withLock(root, async () => {
      if (isInstalled(root, manifest.id)) {
        rmSync(staging, { recursive: true, force: true });
        return { id: manifest.id, installed: false };
      }
      const dest = engineDir(root, manifest.id);
      rmSync(dest, { recursive: true, force: true });
      renameSync(staging, dest);
      writeFileSync(markerPath(root, manifest.id), `${new Date().toISOString()}\n`);
      return { id: manifest.id, installed: true };
    });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
};

export type VerifyResult = {
  readonly id: string;
  readonly ok: boolean;
  readonly problems: string[];
};

/**
 * Structural check only: marker present, `engine.json` id matches the dir, and
 * the declared `soname` exists in `lib/`.
 */
export const verifyEngine = (root: string, id: string): VerifyResult => {
  const problems: string[] = [];
  const dir = engineDir(root, id);
  if (!existsSync(dir)) {
    return { id, ok: false, problems: [`not installed (no directory ${dir})`] };
  }
  if (!isInstalled(root, id)) {
    problems.push('missing INSTALLATION_COMPLETE marker (incomplete install)');
  }
  try {
    const manifest = readEngineManifest(dir);
    if (manifest.id !== id) {
      problems.push(`engine.json id ${manifest.id} does not match dir ${id}`);
    }
    if (!existsSync(join(dir, 'lib', manifest.soname))) {
      problems.push(`missing lib/${manifest.soname}`);
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return { id, ok: problems.length === 0, problems };
};

export type GcDeps = {
  /** Whether an app's install path still exists (default: real fs check). */
  readonly exists?: (appPath: string) => boolean;
  /** Report only; delete nothing. */
  readonly dryRun?: boolean;
};

export type GcResult = {
  readonly kept: string[];
  readonly removed: string[];
  readonly droppedLinks: number;
};

/**
 * An engine is kept iff some live app still links it. Links whose app no longer
 * exists are dropped first, freeing their engines. `dryRun` mutates nothing and
 * reports what WOULD be removed.
 */
export const gc = async (root: string, deps: GcDeps = {}): Promise<GcResult> => {
  const exists = deps.exists ?? existsSync;
  const dryRun = deps.dryRun === true;
  const scan = (): GcResult => {
    let droppedLinks = 0;
    const used = new Set<string>();
    for (const link of readLinks(root)) {
      if (exists(link.app)) {
        used.add(link.engine);
      } else {
        droppedLinks += 1;
        if (!dryRun) {
          unlinkApp(root, link.app);
        }
      }
    }
    const installed = listInstalled(root);
    const removed = installed.filter((id) => !used.has(id)).sort();
    const kept = installed.filter((id) => used.has(id)).sort();
    if (!dryRun) {
      for (const id of removed) {
        rmSync(engineDir(root, id), { recursive: true, force: true });
      }
    }
    return { kept, removed, droppedLinks };
  };
  // A dry run mutates nothing, so it needs no lock; a real gc takes the store
  // lock so it can't delete an engine a concurrent install is renaming in.
  return dryRun ? scan() : withLock(root, async () => scan());
};

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

/**
 * Run `fn` under the store's cross-process lock. A lock older than
 * STALE_LOCK_MS is stolen; the lock is always released, even if `fn` throws.
 */
export const withLock = async <T>(root: string, fn: () => Promise<T>): Promise<T> => {
  mkdirSync(root, { recursive: true });
  const lock = lockPath(root);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      const age = Date.now() - statSync(lock).mtimeMs;
      if (age > STALE_LOCK_MS) {
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new BunmaskaError(`engine store: timed out acquiring lock at ${lock}`, {
          code: 'ERR_ENGINE_LOCK',
        });
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
};
