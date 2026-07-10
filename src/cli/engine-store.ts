/**
 * The shared, content-addressed WebKit engine store — Bunmaska's "tested ==
 * shipped" mechanism, modelled on Playwright's browser registry (NOT nvm).
 *
 * Many engine versions live side by side under `~/.bunmaska/webkit/<engine-id>/`;
 * every installed app records the exact id it was built against and resolves
 * THAT id at launch, so different apps pin different WebKit versions and run
 * simultaneously. There is no global "current" engine. A store dir is kept iff
 * some installed app (a `.links/*` refcount entry) still needs it.
 *
 * Integrity follows Playwright's marker scheme: a fully + correctly installed
 * engine is the one with an `INSTALLATION_COMPLETE` marker, written LAST after
 * the content hash verifies — a half-download has no marker and is re-fetched.
 *
 * The mutating operations take an explicit `root` (the `webkit/` dir) so they
 * are testable against a temp dir with no global env mutation; `enginesPath`
 * computes the real default root from the environment.
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

/** The marker file proving an engine dir is fully + correctly installed. */
export const INSTALLATION_COMPLETE = 'INSTALLATION_COMPLETE';
const LINKS_DIR = '.links';
const LOCK_FILE = '__dirlock';
const STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 10_000;

/** Environment slice the default-path resolution reads. */
export type StoreEnv = Record<string, string | undefined>;

/** The default home dir of the store: `$BUNMASKA_HOME` or `~/.bunmaska`. */
const defaultHome = (env: StoreEnv): string =>
  env['BUNMASKA_HOME'] ?? join(env['HOME'] ?? env['USERPROFILE'] ?? homedir(), '.bunmaska');

/**
 * The engine store root (`webkit/` dir): `$BUNMASKA_ENGINES_PATH`, else
 * `<home>/webkit`. The single env-reading function — all other ops take `root`.
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
    isAbsolute(id) ||
    !dir.startsWith(base + sep);
  if (unsafe) {
    throw new BunmaskaError(`engine store: refusing unsafe engine id ${JSON.stringify(id)}`, {
      code: 'ERR_ENGINE_ID',
    });
  }
};

/** Absolute dir of one engine id under the store root. */
export const engineDir = (root: string, id: string): string => join(root, id);

/** Absolute path of an engine's installation marker. */
export const markerPath = (root: string, id: string): string =>
  join(root, id, INSTALLATION_COMPLETE);

/** Refcount link-file path for an installed app (stable hash of its install path). */
export const linkPath = (root: string, appPath: string): string =>
  join(root, LINKS_DIR, createHash('sha1').update(appPath).digest('hex'));

/** Absolute path of the cross-process store lock. */
export const lockPath = (root: string): string => join(root, LOCK_FILE);

/** Whether an engine id is fully installed (has its `INSTALLATION_COMPLETE` marker). */
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

/** Drop an app's refcount entry (e.g. on uninstall). */
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

/** A self-describing engine artifact to install: bytes + the hash its manifest claims. */
export type InstallSource = {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly expectedHash: string;
};

/** Injectable side effects for {@link installFromSource}. */
export type InstallDeps = {
  /** Populate `destDir` with the engine tree (`lib/`, `engine.json`) from the bytes. */
  readonly extract: (bytes: Uint8Array, destDir: string) => Promise<void>;
  /** Hook fired immediately after the marker is written (test seam for ordering). */
  readonly onMarker?: () => void;
};

/** Outcome of an install attempt. */
export type InstallResult = { readonly id: string; readonly installed: boolean };

/**
 * Install one engine from its artifact bytes: verify the content hash, extract
 * to a temp staging dir, atomically swap it into place, then write the marker
 * LAST. Idempotent — a fully-installed id is left untouched. A hash mismatch
 * throws and leaves no engine dir behind.
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
    const dest = engineDir(root, source.id);
    rmSync(dest, { recursive: true, force: true }); // clear any partial prior install
    renameSync(staging, dest);
    writeFileSync(markerPath(root, source.id), `${new Date().toISOString()}\n`);
    deps.onMarker?.();
    return { id: source.id, installed: true };
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
 * Install an engine from a local, already-extracted engine DIRECTORY (a `lib/` +
 * `engine.json` tree the developer built or fetched deliberately — the trusted
 * local source for Phase 1; remote hash-verified installs are the follow-up).
 * Copies the tree in atomically and writes the marker last. Idempotent.
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
    const dest = engineDir(root, manifest.id);
    rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
    writeFileSync(markerPath(root, manifest.id), `${new Date().toISOString()}\n`);
    return { id: manifest.id, installed: true };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
};

/** The outcome of {@link verifyEngine}: structural integrity of an installed engine. */
export type VerifyResult = {
  readonly id: string;
  readonly ok: boolean;
  readonly problems: string[];
};

/**
 * Structurally verify an installed engine: the marker is present, `engine.json`
 * parses and its id matches the dir, and the declared `soname` exists in `lib/`.
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

/** Injectable side effects for {@link gc}. */
export type GcDeps = {
  /** Whether an app's install path still exists (default: real fs check). */
  readonly exists?: (appPath: string) => boolean;
  /** Report only; delete nothing. */
  readonly dryRun?: boolean;
};

/** What {@link gc} kept, removed, and how many dead-app links it dropped. */
export type GcResult = {
  readonly kept: string[];
  readonly removed: string[];
  readonly droppedLinks: number;
};

/**
 * Garbage-collect the store: an engine is kept iff some live app still links it.
 * Links whose app no longer exists are dropped first (freeing their engines).
 * With `dryRun`, nothing is mutated — the result reports what WOULD be removed.
 */
export const gc = async (root: string, deps: GcDeps = {}): Promise<GcResult> => {
  const exists = deps.exists ?? existsSync;
  const dryRun = deps.dryRun === true;
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

const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

/**
 * Run `fn` while holding the store's cross-process lock. Acquires by exclusive
 * file create, retries while another holder is live, steals a stale lock, and
 * always releases — even if `fn` throws.
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
        rmSync(lock, { force: true }); // steal a stale lock
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
