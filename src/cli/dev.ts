/** `bunmaska dev`: runs the app and restarts, rebuilds or reloads it as files change. */

import { resolve } from 'node:path';
import type { BunmaskaConfig } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';
import { DEV_RELOAD_COMMAND } from '../main/dev-reload';
import { type ChangeAction, devClassifier } from './dev-classify';
import { DEV_STATE_FILE, watchTree } from './dev-watch';

export { classifyChange, devClassifier } from './dev-classify';

export const DEV_DEFAULT_ENTRY = 'src/main.ts';

/** Default debounce window (ms) collapsing a burst of file changes into one action. */
export const DEV_DEBOUNCE_MS = 120;

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

/** The explicit entry, then the config's `entry`, then {@link DEV_DEFAULT_ENTRY}. */
export const resolveDevEntry = (config: BunmaskaConfig, explicit?: string): string =>
  explicit ?? config.entry ?? DEV_DEFAULT_ENTRY;

/** Debounce-window precedence: a restart (which rebuilds first) beats a rebuild beats a reload. */
const ACTION_RANK: Record<Exclude<ChangeAction, 'ignore'>, number> = {
  restart: 3,
  rebuild: 2,
  reload: 1,
};

export type DevChild = {
  /** SIGTERM, or SIGKILL when `force`. */
  readonly kill: (force?: boolean) => void;
  /** Live-reload the child's open windows. */
  readonly reload: () => void;
  /**
   * Settles when the process is gone. Await it before respawning: `kill()` only
   * signals, and two live apps race for the window and the single-instance lock.
   */
  readonly exited?: Promise<unknown>;
};
export type DevWatcher = { readonly close: () => void };
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
      // The bundle's writes come back through the watcher as reloads.
      this.#rebuild();
      return;
    }
    // A reload sent to a child that already quit is silently lost.
    if (!this.#alive) {
      this.#deps.log('app is not running - edit a main-process file to restart it');
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
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const defaultDevDeps = (
  cwd: string,
  log: (message: string) => void,
  extraEnv: Readonly<Record<string, string>> = {},
): DevDeps => ({
  spawn: (entry, opts) => {
    // BUNMASKA_DEV turns on the app's stdin reload listener; BUNMASKA_DEV_RESTART
    // shows a respawned window without stealing focus from the editor.
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

/** Supervise `entry` in `targetDir` until `awaitStop` resolves; the supervisor is torn down either way. */
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
