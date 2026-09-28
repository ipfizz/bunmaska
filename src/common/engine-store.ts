// The engine store: `<root>/<engine-id>/`, side by side, refcounted by `.links/`. An engine
// is installed iff its INSTALLATION_COMPLETE marker exists, so the marker is written last
// and removed first; a half-written or half-deleted engine never looks installed.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { parseEngineId } from './engine-id';
import { BunmaskaError } from './errors';
import { contentHash } from './manifest';

export const INSTALLATION_COMPLETE = 'INSTALLATION_COMPLETE';
/** The dir beside the executable that `build --embed-engine` copies an engine into. */
export const BUNDLED_ENGINE_DIRNAME = 'webkit';
const LINKS_DIR = '.links';
const LOCK_FILE = '__dirlock';
const STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 10_000;
/** Younger staging dirs may belong to an install still extracting. */
const STALE_STAGING_MS = 60 * 60_000;

export type StoreEnv = Record<string, string | undefined>;

const defaultHome = (env: StoreEnv): string =>
  env['BUNMASKA_HOME'] ?? join(env['HOME'] ?? env['USERPROFILE'] ?? homedir(), '.bunmaska');

export const enginesPath = (env: StoreEnv = process.env): string =>
  env['BUNMASKA_ENGINES_PATH'] ?? join(defaultHome(env), 'webkit');

const isEngineId = (name: string): boolean => {
  try {
    parseEngineId(name);
    return true;
  } catch {
    return false;
  }
};

/**
 * Reject an id that is not one contained dir segment under `root`, or that no app could pin.
 * Ids arrive untrusted (feed manifest, engine.json) and name dirs install `rm`s and renames
 * over: `../../x` or an absolute path would be traversal plus arbitrary delete.
 */
export const assertSafeEngineId = (root: string, id: string): void => {
  const base = resolve(root);
  const dir = resolve(base, id);
  const unsafe =
    id.length === 0 ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    id.startsWith('.') || // .links, .tmp-*: store internals
    id === LOCK_FILE ||
    id === INSTALLATION_COMPLETE ||
    isAbsolute(id) ||
    !dir.startsWith(base + sep);
  if (unsafe) {
    throw new BunmaskaError(`engine store: refusing unsafe engine id ${JSON.stringify(id)}`, {
      code: 'ERR_ENGINE_ID',
    });
  }
  if (!isEngineId(id)) {
    throw new BunmaskaError(
      `engine store: ${JSON.stringify(id)} is not a valid engine-id, so no app could pin it`,
      { code: 'ERR_ENGINE_ID' },
    );
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

/** Register an app as needing `engineId`; renamed into place, so a crash never tears it. */
export const linkApp = (root: string, appPath: string, engineId: string): void => {
  mkdirSync(join(root, LINKS_DIR), { recursive: true });
  const path = linkPath(root, appPath);
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify({ app: appPath, engine: engineId }));
  renameSync(staging, path);
};

export const unlinkApp = (root: string, appPath: string): void => {
  rmSync(linkPath(root, appPath), { force: true });
};

/** Link files are named by the sha1 of the app path; anything else is a write in progress. */
const LINK_NAME = /^[0-9a-f]{40}$/;

const scanLinks = (root: string): { links: EngineLink[]; unreadable: string[] } => {
  const dir = join(root, LINKS_DIR);
  const links: EngineLink[] = [];
  const unreadable: string[] = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (!LINK_NAME.test(name)) {
      continue;
    }
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Partial<EngineLink>;
      if (typeof raw.app === 'string' && typeof raw.engine === 'string') {
        links.push({ app: raw.app, engine: raw.engine });
        continue;
      }
    } catch {
      // Counted below.
    }
    unreadable.push(join(dir, name));
  }
  return { links, unreadable };
};

/** Read every refcount entry. Malformed entries are skipped. */
export const readLinks = (root: string): EngineLink[] => scanLinks(root).links;

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

/** Swap populated staging into place under the store lock; the slow extract/copy ran outside it. */
const swapIn = async (
  root: string,
  id: string,
  staging: string,
  soname: string,
  onMarker?: () => void,
): Promise<InstallResult> => {
  if (!existsSync(join(staging, 'lib', soname))) {
    throw new BunmaskaError(`engine ${id}: no lib/${soname} (its engine.json soname)`, {
      code: 'ERR_ENGINE_MANIFEST',
    });
  }
  return withLock(root, async () => {
    if (isInstalled(root, id)) {
      rmSync(staging, { recursive: true, force: true });
      return { id, installed: false };
    }
    const dest = engineDir(root, id);
    rmSync(dest, { recursive: true, force: true }); // clear a partial prior install
    renameSync(staging, dest);
    writeFileSync(markerPath(root, id), `${new Date().toISOString()}\n`);
    onMarker?.();
    return { id, installed: true };
  });
};

/** Idempotent; a hash mismatch throws and leaves no engine dir behind. */
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
      `engine ${source.id}: integrity check failed: hash ${actual} != expected ${source.expectedHash}`,
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
    return await swapIn(root, source.id, staging, extracted.soname, deps.onMarker);
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
    // PowerShell 5.1 writes a UTF-8 BOM.
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

/** Install a local, already-extracted engine tree; unsigned, unlike feed installs. Idempotent. */
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
    return await swapIn(root, manifest.id, staging, manifest.soname);
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

/** Structural check only: the marker, the engine.json id, and its soname in `lib/`. */
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
  /** Recursive delete (default: `rmSync`). */
  readonly remove?: (path: string) => void;
};

export type GcResult = {
  readonly kept: string[];
  readonly removed: string[];
  readonly droppedLinks: number;
};

/**
 * Keep the engines a live app links; drop dead links, then remove every other engine
 * and interrupted-install leftovers. `dryRun` only reports.
 */
export const gc = async (root: string, deps: GcDeps = {}): Promise<GcResult> => {
  const exists = deps.exists ?? existsSync;
  const dryRun = deps.dryRun === true;
  const remove = deps.remove ?? ((path: string) => rmSync(path, { recursive: true, force: true }));
  const scan = (): GcResult => {
    const { links, unreadable } = scanLinks(root);
    if (unreadable.length > 0) {
      // Its engine may be in use: fail closed rather than free it.
      throw new BunmaskaError(
        `engine store: unreadable app link ${unreadable[0]}; delete it or relaunch that app, then prune again`,
        { code: 'ERR_ENGINE_LINK' },
      );
    }
    let droppedLinks = 0;
    const used = new Set<string>();
    for (const link of links) {
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
    const dirs = existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];
    const broken = dirs.filter((name) => isEngineId(name) && !isInstalled(root, name));
    const staleStaging = dirs.filter(
      (name) =>
        name.startsWith('.tmp-') &&
        Date.now() - statSync(join(root, name)).mtimeMs > STALE_STAGING_MS,
    );
    const removed = [...installed.filter((id) => !used.has(id)), ...broken].sort();
    const kept = installed.filter((id) => used.has(id)).sort();
    if (!dryRun) {
      for (const id of removed) {
        remove(markerPath(root, id)); // first, so a half-deleted engine never looks installed
        remove(engineDir(root, id));
      }
      for (const name of staleStaging) {
        remove(join(root, name));
      }
    }
    return { kept, removed, droppedLinks };
  };
  // A dry run mutates nothing, so it needs no lock; a real gc takes the store
  // lock so it can't delete an engine a concurrent install is renaming in.
  return dryRun ? scan() : withLock(root, async () => scan());
};

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
};

/** Whether a held lock may be stolen: its holder died, or it is older than STALE_LOCK_MS. */
const isStaleLock = (lock: string): boolean => {
  const pid = Number.parseInt(readFileSync(lock, 'utf8'), 10);
  return (
    (Number.isInteger(pid) && !isAlive(pid)) || Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS
  );
};

/** Remove the lock only while it still holds `pid`: a stealer may have replaced it. */
const releaseLock = (lock: string, pid: string): void => {
  let holder: string;
  try {
    holder = readFileSync(lock, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (holder === pid) {
    rmSync(lock, { force: true });
  }
};

/**
 * Run `fn` under the store's cross-process pidfile lock, stealing a stale one. Released
 * even if `fn` throws, but only while it still holds our pid.
 * ponytail: two contenders stealing one stale lock can both enter; add a steal lock if it bites
 */
export const withLock = async <T>(root: string, fn: () => Promise<T>): Promise<T> => {
  mkdirSync(root, { recursive: true });
  const lock = lockPath(root);
  const pid = String(process.pid);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      writeFileSync(lock, pid, { flag: 'wx' });
      break;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw error;
      }
    }
    try {
      if (isStaleLock(lock)) {
        rmSync(lock, { force: true });
        continue;
      }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        continue; // released between our attempt and the check
      }
      throw error;
    }
    if (Date.now() > deadline) {
      throw new BunmaskaError(`engine store: timed out acquiring lock at ${lock}`, {
        code: 'ERR_ENGINE_LOCK',
      });
    }
    await sleep(LOCK_RETRY_MS);
  }
  try {
    return await fn();
  } finally {
    releaseLock(lock, pid);
  }
};
