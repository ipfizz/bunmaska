// The primary/secondary decision must stay SYNCHRONOUS (Electron's contract, D031): an atomic
// pidfile naming a live process makes this a secondary. The argv hand-off rides a unix socket.

export type SecondInstancePayload = {
  readonly argv: string[];
  readonly cwd: string;
  readonly additionalData: unknown;
};

export type LockPaths = {
  readonly lockPath: string;
  readonly socketPath: string;
  readonly pid: number;
};

export type LockBackend = {
  /** Must be ATOMIC; returns `false` when the lock file already exists. */
  tryCreateLock(lockPath: string, pid: number): boolean;
  /** `undefined` if the lock file is missing or unreadable. */
  readLockPid(lockPath: string): number | undefined;
  isAlive(pid: number): boolean;
  /** Removes the stale lock file (a stale socket is replaced by `startServer`). */
  clearLock(lockPath: string): void;
  startServer(socketPath: string, onMessage: (json: string) => void): void;
  /** Fire-and-forget. */
  notify(socketPath: string, json: string): void;
  /** Stops the server and removes the lock and socket. */
  stop(lockPath: string, socketPath: string): void;
};

export const encodePayload = (payload: SecondInstancePayload): string => JSON.stringify(payload);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** `undefined` if malformed or missing `argv`. */
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
  if (!isStringArray(argv) || typeof cwd !== 'string') {
    return undefined;
  }
  return { argv, cwd, additionalData: record['additionalData'] };
};

export class SingleInstanceManager {
  readonly #backend: LockBackend;
  readonly #paths: LockPaths;
  #locked = false;

  constructor(backend: LockBackend, paths: LockPaths) {
    this.#backend = backend;
    this.#paths = paths;
  }

  /** Whether this process is the primary. */
  has(): boolean {
    return this.#locked;
  }

  /** `false` means another live instance holds the lock; `payload` is sent to it asynchronously. */
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
    // The recorded primary is gone: reclaim the stale lock and retry once.
    this.#backend.clearLock(this.#paths.lockPath); // ponytail: races a concurrent reclaim and trusts a reusable pid; flock/LockFileEx fixes both
    return this.#acquire(onSecondInstance);
  }

  /** No-op when the lock is not held. */
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
