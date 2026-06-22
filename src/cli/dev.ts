/**
 * `bunmaska dev` — run the app and restart it when source files change.
 *
 * The entry is taken from the argument or `bunmaska.config.ts`. A recursive watch
 * over the project triggers a debounced restart of the `bun run <entry>` child,
 * ignoring `node_modules`, VCS, build output and dotfiles. The restart
 * supervisor takes injectable spawn/watch/timer seams so its behaviour is
 * unit-testable without real processes or the filesystem.
 */

import { watch as fsWatch } from 'node:fs';
import { resolve } from 'node:path';
import type { BunmaskaConfig } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';

/** The entry used when neither an argument nor a config entry is given. */
export const DEV_DEFAULT_ENTRY = 'src/main.ts';

/** Default debounce window (ms) collapsing a burst of file changes into one restart. */
export const DEV_DEBOUNCE_MS = 120;

/**
 * Resolve the dev entry: the explicit argument wins, then the config's `entry`,
 * then {@link DEV_DEFAULT_ENTRY}. Pure.
 */
export const resolveDevEntry = (config: BunmaskaConfig, explicit?: string): string =>
  explicit ?? config.entry ?? DEV_DEFAULT_ENTRY;

const IGNORED_SEGMENTS: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist']);

/**
 * Whether a changed path (relative to the watched root) should trigger a
 * restart. Ignores dependency/VCS/build directories and dotfiles (which catch
 * editor swap files). Pure.
 */
export const shouldRestart = (relPath: string): boolean => {
  const parts = relPath.split(/[\\/]/).filter((p) => p.length > 0);
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) {
    return false;
  }
  const base = parts[parts.length - 1] ?? '';
  return base.length > 0 && !base.startsWith('.');
};

/** A running child app process. */
export type DevChild = { readonly kill: () => void };
/** A filesystem watcher that can be torn down. */
export type DevWatcher = { readonly close: () => void };
/** Minimal timer seam (defaults to global setTimeout/clearTimeout). */
export type DevTimers = {
  readonly set: (fn: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
};

/** Injectable seams backing {@link DevSupervisor}. */
export type DevDeps = {
  readonly spawn: (entry: string) => DevChild;
  readonly watch: (dir: string, onChange: (relPath: string) => void) => DevWatcher;
  readonly timers: DevTimers;
  readonly log: (message: string) => void;
  readonly debounceMs?: number;
};

/**
 * Supervises a `bun run <entry>` child: spawns it on construction, restarts it
 * (debounced) on a relevant file change, and tears everything down on
 * {@link stop}.
 */
export class DevSupervisor {
  readonly #entry: string;
  readonly #deps: DevDeps;
  readonly #debounceMs: number;
  #child: DevChild;
  readonly #watcher: DevWatcher;
  #pending: unknown;
  #stopped = false;
  /** Number of times the child has been (re)started, including the first spawn. */
  starts = 1;

  constructor(dir: string, entry: string, deps: DevDeps) {
    this.#entry = entry;
    this.#deps = deps;
    this.#debounceMs = deps.debounceMs ?? DEV_DEBOUNCE_MS;
    this.#child = deps.spawn(entry);
    this.#watcher = deps.watch(dir, (relPath) => {
      this.#onChange(relPath);
    });
  }

  #onChange(relPath: string): void {
    if (this.#stopped || !shouldRestart(relPath)) {
      return;
    }
    if (this.#pending !== undefined) {
      this.#deps.timers.clear(this.#pending);
    }
    this.#pending = this.#deps.timers.set(() => {
      this.#restart();
    }, this.#debounceMs);
  }

  #restart(): void {
    this.#pending = undefined;
    if (this.#stopped) {
      return;
    }
    this.#child.kill();
    this.#child = this.#deps.spawn(this.#entry);
    this.starts += 1;
    this.#deps.log(`restarted (${this.#entry})`);
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

/** Production seams: real `bun run` children and a recursive filesystem watch. */
export const defaultDevDeps = (cwd: string, log: (message: string) => void): DevDeps => ({
  spawn: (entry) => {
    const proc = Bun.spawn(['bun', 'run', entry], {
      cwd,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    return {
      kill: () => {
        proc.kill();
      },
    };
  },
  watch: (dir, onChange) => {
    const watcher = fsWatch(dir, { recursive: true }, (_event, filename) => {
      if (filename !== null) {
        onChange(filename.toString());
      }
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
 * Start a dev supervisor for `targetDir`/`entry` and resolve only once `stop`
 * is signalled (e.g. SIGINT). `awaitStop` lets the CLI block until the user
 * quits; tests pass their own to resolve deterministically.
 */
export const runDev = async (
  targetDir: string,
  entry: string,
  awaitStop: (stop: () => void) => Promise<void>,
  deps?: DevDeps,
): Promise<void> => {
  const dir = resolve(targetDir);
  if (entry.trim().length === 0) {
    throw new InvalidArgumentError('bunmaska dev: entry must not be empty');
  }
  const effectiveDeps =
    deps ?? defaultDevDeps(dir, (message) => process.stdout.write(`${message}\n`));
  const supervisor = new DevSupervisor(dir, entry, effectiveDeps);
  try {
    await awaitStop(() => {
      supervisor.stop();
    });
  } finally {
    supervisor.stop();
  }
};
