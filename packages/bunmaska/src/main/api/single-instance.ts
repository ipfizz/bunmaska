/**
 * Single-instance lock + second-instance messaging (Electron's
 * `requestSingleInstanceLock` / `second-instance`).
 *
 * The primary/secondary decision is synchronous (Electron's contract): a pidfile
 * is created atomically; if it already exists and names a live process, this
 * process is a secondary. Argv hand-off to the primary uses a unix socket. All
 * I/O is injected as a {@link LockBackend} so the decision logic unit-tests
 * without touching the filesystem or sockets.
 */

/** The data a secondary hands to the primary when it starts. */
export type SecondInstancePayload = {
  readonly argv: string[];
  readonly cwd: string;
  readonly additionalData: unknown;
};

/** Filesystem/socket paths + this process's pid for a lock. */
export type LockPaths = {
  readonly lockPath: string;
  readonly socketPath: string;
  readonly pid: number;
};

/** The injected I/O a {@link SingleInstanceManager} performs. */
export type LockBackend = {
  /** Atomically create the lock file recording `pid`; `false` if it already exists. */
  tryCreateLock(lockPath: string, pid: number): boolean;
  /** The pid recorded in the lock file, or `undefined` if missing/unreadable. */
  readLockPid(lockPath: string): number | undefined;
  /** Whether a process with `pid` is currently running. */
  isAlive(pid: number): boolean;
  /** Remove a stale lock file (and its socket). */
  clearLock(lockPath: string): void;
  /** Begin listening for second-instance messages (primary). */
  startServer(socketPath: string, onMessage: (json: string) => void): void;
  /** Send a payload to the primary (secondary, fire-and-forget). */
  notify(socketPath: string, json: string): void;
  /** Stop the server and remove the lock + socket (release). */
  stop(lockPath: string, socketPath: string): void;
};

/** Serialize a second-instance payload for transport. */
export const encodePayload = (payload: SecondInstancePayload): string => JSON.stringify(payload);

/** Parse a transported payload; `undefined` if malformed or missing `argv`. */
export const decodePayload = (json: string): SecondInstancePayload | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const argv = record['argv'];
  const cwd = record['cwd'];
  if (!Array.isArray(argv) || typeof cwd !== 'string') {
    return undefined;
  }
  return { argv: argv as string[], cwd, additionalData: record['additionalData'] };
};

/** Owns the single-instance lock for the process. */
export class SingleInstanceManager {
  readonly #backend: LockBackend;
  readonly #paths: LockPaths;
  #locked = false;

  constructor(backend: LockBackend, paths: LockPaths) {
    this.#backend = backend;
    this.#paths = paths;
  }

  /** Whether this process currently holds the lock (is the primary). */
  has(): boolean {
    return this.#locked;
  }

  /**
   * Try to become the primary instance. Returns `true` if the lock was acquired;
   * `false` if another live instance holds it (after handing it `payload`, which
   * surfaces there via the callback registered by the primary's `request`).
   */
  request(
    payload: SecondInstancePayload,
    onSecondInstance: (p: SecondInstancePayload) => void,
  ): boolean {
    if (this.#locked) {
      return true;
    }
    if (this.#acquire(onSecondInstance)) {
      return true;
    }
    const existing = this.#backend.readLockPid(this.#paths.lockPath);
    if (existing !== undefined && existing !== this.#paths.pid && this.#backend.isAlive(existing)) {
      this.#backend.notify(this.#paths.socketPath, encodePayload(payload));
      return false;
    }
    // The recorded primary is gone — reclaim the stale lock and retry once.
    this.#backend.clearLock(this.#paths.lockPath);
    return this.#acquire(onSecondInstance);
  }

  /** Release the lock if held (stops the server, removes the lock + socket). */
  release(): void {
    if (!this.#locked) {
      return;
    }
    this.#backend.stop(this.#paths.lockPath, this.#paths.socketPath);
    this.#locked = false;
  }

  #acquire(onSecondInstance: (p: SecondInstancePayload) => void): boolean {
    if (!this.#backend.tryCreateLock(this.#paths.lockPath, this.#paths.pid)) {
      return false;
    }
    this.#backend.startServer(this.#paths.socketPath, (json) => {
      const payload = decodePayload(json);
      if (payload !== undefined) {
        onSecondInstance(payload);
      }
    });
    this.#locked = true;
    return true;
  }
}
