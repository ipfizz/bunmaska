/**
 * `bunmaska dev`: a change in the main-process graph restarts the
 * `bun run <entry>` child; any other watched file is a renderer asset and
 * live-reloads the open windows in place.
 */

import { type Dirent, readdirSync, readFileSync, statSync, watch as fsWatch } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { BunmaskaConfig } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';

export const DEV_DEFAULT_ENTRY = 'src/main.ts';

/** Default debounce window (ms) collapsing a burst of file changes into one action. */
export const DEV_DEBOUNCE_MS = 120;

/**
 * Precedence: the explicit argument, then the config's `entry`, then
 * {@link DEV_DEFAULT_ENTRY}.
 */
export const resolveDevEntry = (config: BunmaskaConfig, explicit?: string): string =>
  explicit ?? config.entry ?? DEV_DEFAULT_ENTRY;

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

/** TypeScript is compiled into the main process, so a change there restarts it. */
const MAIN_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mts', '.cts']);

/**
 * The preload is read and bundled once, when the window is constructed, so a
 * reload would re-inject the STALE script. Restarting is the honest action.
 * Matches the shipped-asset convention in {@link ../cli/app-assets}.
 */
const PRELOAD_BASENAME = /^preload\.(?:js|mjs|cjs|ts)$/i;

export type ChangeAction = 'restart' | 'rebuild' | 'reload' | 'ignore';

/**
 * Classify a changed path, relative to the watched root. Dotfiles are ignored
 * because they catch editor swap files. With `rendererRoot` set (the directory
 * of `config.renderer.entry`), a change under it is `rebuild`: the renderer is
 * re-bundled and the resulting output writes live-reload the window, so a
 * React component edit no longer restarts the whole app.
 */
export const classifyChange = (relPath: string, rendererRoot?: string): ChangeAction => {
  const parts = relPath.split(/[\\/]/).filter((p) => p.length > 0);
  const ignored = (p: string): boolean =>
    IGNORED_SEGMENTS.has(p) || IGNORED_SEGMENT_SUFFIXES.some((suffix) => p.endsWith(suffix));
  if (parts.some(ignored)) {
    return 'ignore';
  }
  const base = parts[parts.length - 1] ?? '';
  if (base.length === 0 || base.startsWith('.')) {
    return 'ignore';
  }
  if (PRELOAD_BASENAME.test(base)) {
    return 'restart';
  }
  if (rendererRoot !== undefined) {
    const rootParts = rendererRoot.split(/[\\/]/).filter((p) => p.length > 0);
    const underRoot =
      rootParts.length > 0 &&
      rootParts.length < parts.length &&
      rootParts.every((part, i) => parts[i] === part);
    if (underRoot) {
      return 'rebuild';
    }
  }
  return MAIN_SOURCE_EXTENSIONS.has(extname(base).toLowerCase()) ? 'restart' : 'reload';
};

/** Debounce-window precedence: a restart beats a rebuild beats a reload. */
const ACTION_RANK: Record<Exclude<ChangeAction, 'ignore'>, number> = {
  restart: 3,
  rebuild: 2,
  reload: 1,
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
  const parts = relPath.split(/[\\/]/).filter((p) => p.length > 0);
  const ignored = (p: string): boolean =>
    IGNORED_SEGMENTS.has(p) || IGNORED_SEGMENT_SUFFIXES.some((suffix) => p.endsWith(suffix));
  if (parts.length === 0 || parts.some(ignored)) {
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
      if (
        !IGNORED_SEGMENTS.has(name) &&
        !IGNORED_SEGMENT_SUFFIXES.some((suffix) => name.endsWith(suffix))
      ) {
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

export type DevChild = {
  readonly kill: () => void;
  /** Ask the running child to live-reload its open windows (a renderer-only change). */
  readonly reload: () => void;
  /**
   * Settles when the process is really gone. Awaited before respawning: `kill()`
   * only delivers a signal, so spawning immediately leaves two live apps racing
   * for the window and the single-instance lock.
   */
  readonly exited?: Promise<unknown>;
};
export type DevWatcher = { readonly close: () => void };
/** Timers; defaults to the global setTimeout/clearTimeout. */
export type DevTimers = {
  readonly set: (fn: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
};

export type DevDeps = {
  readonly spawn: (entry: string) => DevChild;
  readonly watch: (dir: string, onChange: (relPath: string) => void) => DevWatcher;
  readonly timers: DevTimers;
  readonly log: (message: string) => void;
  readonly debounceMs?: number;
  /** Overrides {@link classifyChange} (e.g. bound to a renderer root). */
  readonly classify?: (relPath: string) => ChangeAction;
  /**
   * Rebuild the configured renderer. Must not throw: a broken renderer edit
   * must never take the dev loop down with it.
   */
  readonly rebuild?: () => void | Promise<void>;
};

export class DevSupervisor {
  readonly #entry: string;
  readonly #deps: DevDeps;
  readonly #debounceMs: number;
  #child: DevChild;
  readonly #watcher: DevWatcher;
  #pending: unknown;
  #pendingAction: Exclude<ChangeAction, 'ignore'> | undefined;
  #stopped = false;
  #restarting = false;
  #alive = true;
  /** Number of times the child has been (re)started, including the first spawn. */
  starts = 1;
  reloads = 0;

  constructor(dir: string, entry: string, deps: DevDeps) {
    this.#entry = entry;
    this.#deps = deps;
    this.#debounceMs = deps.debounceMs ?? DEV_DEBOUNCE_MS;
    this.#child = this.#track(deps.spawn(entry));
    this.#watcher = deps.watch(dir, (relPath) => {
      this.#onChange(relPath);
    });
  }

  #onChange(relPath: string): void {
    if (this.#stopped) {
      return;
    }
    const action = (this.#deps.classify ?? classifyChange)(relPath);
    if (action === 'ignore') {
      return;
    }
    // The strongest action coalesced into the debounce window wins.
    this.#pendingAction =
      this.#pendingAction !== undefined && ACTION_RANK[this.#pendingAction] >= ACTION_RANK[action]
        ? this.#pendingAction
        : action;
    if (this.#pending !== undefined) {
      this.#deps.timers.clear(this.#pending);
    }
    this.#pending = this.#deps.timers.set(() => {
      this.#fire();
    }, this.#debounceMs);
  }

  #fire(): void {
    this.#pending = undefined;
    if (this.#stopped) {
      return;
    }
    const action = this.#pendingAction ?? 'restart';
    this.#pendingAction = undefined;
    if (action === 'restart') {
      void this.#restart();
      return;
    }
    if (action === 'rebuild') {
      // The rebuild's own output writes come back through the watcher as
      // 'reload', so the window refreshes only once the new bundle exists.
      void this.#deps.rebuild?.();
      return;
    }
    // Reloading a child that already quit silently does nothing, and logging
    // 'reloaded' at it is how the loop ends up pretending to drive a corpse.
    if (!this.#alive) {
      this.#deps.log('app is not running — edit a main-process file to restart it');
      return;
    }
    this.#child.reload();
    this.reloads += 1;
    this.#deps.log('reloaded');
  }

  async #restart(): Promise<void> {
    if (this.#restarting) {
      return;
    }
    this.#restarting = true;
    try {
      const previous = this.#child;
      previous.kill();
      await previous.exited;
      if (this.#stopped) {
        return;
      }
      this.#child = this.#track(this.#deps.spawn(this.#entry));
      this.starts += 1;
      this.#deps.log(`restarted (${this.#entry})`);
    } finally {
      this.#restarting = false;
    }
  }

  /** Mark the child live and watch for it exiting on its own (a user quit). */
  #track(child: DevChild): DevChild {
    this.#alive = true;
    void child.exited?.then(() => {
      if (this.#child === child) {
        this.#alive = false;
      }
    });
    return child;
  }

  /** Stop watching and kill the child. Idempotent. */
  stop(): void {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    if (this.#pending !== undefined) {
      this.#deps.timers.clear(this.#pending);
      this.#pending = undefined;
    }
    this.#watcher.close();
    this.#child.kill();
  }
}

const defaultTimers: DevTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export const defaultDevDeps = (
  cwd: string,
  log: (message: string) => void,
  extraEnv: Readonly<Record<string, string>> = {},
): DevDeps => ({
  spawn: (entry) => {
    // `BUNMASKA_DEV` switches on the app's stdin reload listener; a piped stdin is
    // how the supervisor delivers reload requests to it.
    const proc = Bun.spawn(['bun', 'run', entry], {
      cwd,
      env: { ...process.env, ...extraEnv, BUNMASKA_DEV: '1' },
      stdin: 'pipe',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return {
      exited: proc.exited,
      kill: () => {
        proc.kill();
      },
      reload: () => {
        try {
          proc.stdin.write('reload\n');
          proc.stdin.flush();
        } catch {
          // The child may be mid-exit; a dropped reload is harmless.
        }
      },
    };
  },
  watch: (dir, onChange) => {
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
        if (classifyChange(rel) !== 'ignore' && filter.changedIfSeen(rel)) {
          onChange(rel);
        }
      }
    };
    const watcher = fsWatch(dir, { recursive: true }, (_event, filename) => {
      if (filename === null) {
        return;
      }
      const relPath = filename.toString();
      const tempDir = editorTempDir(relPath);
      if (tempDir !== undefined) {
        rescan(tempDir);
        return;
      }
      // Classify before hashing so node_modules churn never costs a file read.
      if (classifyChange(relPath) === 'ignore' || !filter.changed(relPath)) {
        return;
      }
      onChange(relPath);
    });
    return {
      close: () => {
        watcher.close();
      },
    };
  },
  timers: defaultTimers,
  log,
});

/**
 * Resolves only once `awaitStop` signals stop (e.g. SIGINT); the supervisor is
 * torn down either way.
 */
export const runDev = async (
  targetDir: string,
  entry: string,
  awaitStop: (stop: () => void) => Promise<void>,
  deps?: DevDeps,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<void> => {
  const dir = resolve(targetDir);
  if (entry.trim().length === 0) {
    throw new InvalidArgumentError('bunmaska dev: entry must not be empty');
  }
  const effectiveDeps =
    deps ?? defaultDevDeps(dir, (message) => process.stdout.write(`${message}\n`), extraEnv);
  const supervisor = new DevSupervisor(dir, entry, effectiveDeps);
  try {
    await awaitStop(() => {
      supervisor.stop();
    });
  } finally {
    supervisor.stop();
  }
};
