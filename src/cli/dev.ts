/**
 * `bunmaska dev`: a TypeScript change restarts the `bun run <entry>` child; any
 * other watched file is a renderer asset and live-reloads the open windows.
 */

import { watch as fsWatch } from 'node:fs';
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

const IGNORED_SEGMENTS: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist']);

/** TypeScript is compiled into the main process, so a change there restarts it. */
const MAIN_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.mts', '.cts']);

export type ChangeAction = 'restart' | 'reload' | 'ignore';

/**
 * Classify a changed path, relative to the watched root. Dotfiles are ignored
 * because they catch editor swap files.
 */
export const classifyChange = (relPath: string): ChangeAction => {
  const parts = relPath.split(/[\\/]/).filter((p) => p.length > 0);
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) {
    return 'ignore';
  }
  const base = parts[parts.length - 1] ?? '';
  if (base.length === 0 || base.startsWith('.')) {
    return 'ignore';
  }
  return MAIN_SOURCE_EXTENSIONS.has(extname(base).toLowerCase()) ? 'restart' : 'reload';
};

export type DevChild = {
  readonly kill: () => void;
  /** Ask the running child to live-reload its open windows (a renderer-only change). */
  readonly reload: () => void;
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
};

export class DevSupervisor {
  readonly #entry: string;
  readonly #deps: DevDeps;
  readonly #debounceMs: number;
  #child: DevChild;
  readonly #watcher: DevWatcher;
  #pending: unknown;
  #pendingAction: 'restart' | 'reload' | undefined;
  #stopped = false;
  /** Number of times the child has been (re)started, including the first spawn. */
  starts = 1;
  reloads = 0;

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
    if (this.#stopped) {
      return;
    }
    const action = classifyChange(relPath);
    if (action === 'ignore') {
      return;
    }
    // A restart subsumes a reload coalesced into the same debounce window.
    this.#pendingAction =
      this.#pendingAction === 'restart' || action === 'restart' ? 'restart' : 'reload';
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
      this.#child.kill();
      this.#child = this.#deps.spawn(this.#entry);
      this.starts += 1;
      this.#deps.log(`restarted (${this.#entry})`);
    } else {
      this.#child.reload();
      this.reloads += 1;
      this.#deps.log('reloaded');
    }
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

export const defaultDevDeps = (cwd: string, log: (message: string) => void): DevDeps => ({
  spawn: (entry) => {
    // `BUNMASKA_DEV` switches on the app's stdin reload listener; a piped stdin is
    // how the supervisor delivers reload requests to it.
    const proc = Bun.spawn(['bun', 'run', entry], {
      cwd,
      env: { ...process.env, BUNMASKA_DEV: '1' },
      stdin: 'pipe',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return {
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
 * Resolves only once `awaitStop` signals stop (e.g. SIGINT); the supervisor is
 * torn down either way.
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
