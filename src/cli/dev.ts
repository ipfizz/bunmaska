/**
 * `bunmaska dev`: a change in the main-process graph restarts the
 * `bun run <entry>` child; any other watched file is a renderer asset and
 * live-reloads the open windows in place.
 */

import { dirname, extname, resolve } from 'node:path';
import type { BunmaskaConfig, BunmaskaRendererConfig } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';
import { DEV_RELOAD_COMMAND } from '../main/dev-reload';
import { DEV_STATE_FILE, isIgnoredPath, mainModules, pathParts, watchTree } from './dev-watch';

export const DEV_DEFAULT_ENTRY = 'src/main.ts';

/** Default debounce window (ms) collapsing a burst of file changes into one action. */
export const DEV_DEBOUNCE_MS = 120;

/** Default for {@link DevDeps.killGraceMs}. */
const DEV_KILL_GRACE_MS = 3000;

/** Resolves true once `promise` settles, or false after `ms`. */
const settlesWithin = (promise: Promise<unknown> | undefined, ms: number): Promise<boolean> =>
  new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), ms);
    void Promise.resolve(promise).then(() => {
      clearTimeout(timer);
      resolvePromise(true);
    });
  });

/**
 * Precedence: the explicit argument, then the config's `entry`, then
 * {@link DEV_DEFAULT_ENTRY}.
 */
export const resolveDevEntry = (config: BunmaskaConfig, explicit?: string): string =>
  explicit ?? config.entry ?? DEV_DEFAULT_ENTRY;

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
    const parts = pathParts(relPath);
    if (action === 'ignore') {
      return action;
    }
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

/** Debounce-window precedence: a restart beats a rebuild beats a reload. */
const ACTION_RANK: Record<Exclude<ChangeAction, 'ignore'>, number> = {
  restart: 3,
  rebuild: 2,
  reload: 1,
};

export type DevChild = {
  /** SIGTERM, or SIGKILL when `force`. */
  readonly kill: (force?: boolean) => void;
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
  /** `restart` is true for every spawn after the first. */
  readonly spawn: (entry: string, opts?: { readonly restart?: boolean }) => DevChild;
  readonly watch: (dir: string, onChange: (relPath: string) => void) => DevWatcher;
  readonly timers: DevTimers;
  readonly log: (message: string) => void;
  readonly debounceMs?: number;
  /** How long a killed child gets to exit before it is force-killed. */
  readonly killGraceMs?: number;
  /** Defaults to {@link devClassifier} without a renderer. */
  readonly classify?: (relPath: string) => ChangeAction;
  /** Rebuild the configured renderer; also runs before every restart. A throw is logged. */
  readonly rebuild?: () => void | Promise<void>;
};

export class DevSupervisor {
  readonly #entry: string;
  readonly #deps: DevDeps;
  readonly #debounceMs: number;
  readonly #classify: (relPath: string) => ChangeAction;
  #child: DevChild;
  readonly #watcher: DevWatcher;
  #pending: unknown;
  #pendingAction: Exclude<ChangeAction, 'ignore'> | undefined;
  #stopped = false;
  #restarting = false;
  #rebuilding: Promise<void> | undefined;
  #rebuildAgain = false;
  #alive = true;
  /** Number of times the child has been (re)started, including the first spawn. */
  starts = 1;
  reloads = 0;

  constructor(dir: string, entry: string, deps: DevDeps) {
    this.#entry = entry;
    this.#deps = deps;
    this.#debounceMs = deps.debounceMs ?? DEV_DEBOUNCE_MS;
    this.#classify = deps.classify ?? devClassifier(dir, entry);
    this.#child = this.#track(deps.spawn(entry));
    this.#watcher = deps.watch(dir, (relPath) => {
      this.#onChange(relPath);
    });
  }

  #onChange(relPath: string): void {
    if (this.#stopped) {
      return;
    }
    const action = this.#classify(relPath);
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
      this.#rebuild();
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

  /** Single-flight: a request mid-build reruns once after it, so the last build sees the last edit. */
  #rebuild(): void {
    const rebuild = this.#deps.rebuild;
    if (rebuild === undefined) {
      return;
    }
    if (this.#rebuilding !== undefined) {
      this.#rebuildAgain = true;
      return;
    }
    this.#rebuilding = (async () => {
      do {
        this.#rebuildAgain = false;
        try {
          await rebuild();
        } catch (error) {
          this.#deps.log(`renderer rebuild failed: ${String(error)}`);
        }
      } while (this.#rebuildAgain && !this.#stopped);
      this.#rebuilding = undefined;
    })();
  }

  async #restart(): Promise<void> {
    // A renderer edit coalesced into this restart must reach the new child.
    this.#rebuild();
    if (this.#restarting) {
      // The restart in flight has not spawned yet and waits for this rebuild.
      return;
    }
    this.#restarting = true;
    try {
      const previous = this.#child;
      previous.kill();
      // A child that traps SIGTERM (a vetoed quit) would otherwise wedge every later restart.
      const grace = this.#deps.killGraceMs ?? DEV_KILL_GRACE_MS;
      if (!(await settlesWithin(previous.exited, grace))) {
        this.#deps.log(`app did not exit ${grace}ms after SIGTERM; force-killed it`);
        previous.kill(true);
        await previous.exited;
      }
      // Spawning mid-build would load a stale or half-written bundle.
      while (this.#rebuilding !== undefined) {
        await this.#rebuilding;
      }
      if (this.#stopped) {
        return;
      }
      this.#child = this.#track(this.#deps.spawn(this.#entry, { restart: true }));
      this.starts += 1;
      this.#deps.log(`restarted (${this.#entry})`);
    } catch (error) {
      this.#deps.log(`restart failed: ${String(error)}`);
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
  spawn: (entry, opts) => {
    // `BUNMASKA_DEV` switches on the app's stdin reload listener; a piped stdin is
    // how the supervisor delivers reload requests to it. `BUNMASKA_DEV_RESTART`
    // tells a respawned app to show its window without taking focus from the
    // editor the developer is typing in.
    const proc = Bun.spawn([process.execPath, 'run', entry], {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
        BUNMASKA_DEV: '1',
        BUNMASKA_DEV_STATE: resolve(cwd, DEV_STATE_FILE),
        ...(opts?.restart ? { BUNMASKA_DEV_RESTART: '1' } : {}),
      },
      stdin: 'pipe',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return {
      exited: proc.exited,
      kill: (force) => {
        proc.kill(force === true ? 'SIGKILL' : undefined);
      },
      reload: () => {
        try {
          proc.stdin.write(`${DEV_RELOAD_COMMAND}\n`);
          proc.stdin.flush();
        } catch {
          // The child may be mid-exit; a dropped reload is harmless.
        }
      },
    };
  },
  watch: (dir, onChange) => watchTree(dir, onChange, log),
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
