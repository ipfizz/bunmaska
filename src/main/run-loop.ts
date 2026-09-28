import { createLogger } from '../common/logger';

// Bun owns the main thread; the pumps lend it to the native UI loop between turns (D020, D047).

const log = createLogger('run-loop');

/** Schedules `onTick` every `intervalMs` and returns a cancel function. */
export type Ticker = (onTick: () => void, intervalMs: number) => () => void;

export type CooperativePumpOptions = {
  /** Milliseconds between drains. Lower = smoother UI, more CPU. Default 16 (~60Hz). */
  readonly intervalMs?: number;
  /** Timer source; defaults to `setInterval`/`clearInterval`. */
  readonly ticker?: Ticker;
};

const DEFAULT_INTERVAL_MS = 16;

const defaultTicker: Ticker = (onTick, intervalMs) => {
  const handle = setInterval(onTick, intervalMs);
  return () => clearInterval(handle);
};

export class CooperativePump {
  readonly #drainOnce: () => void;
  readonly #intervalMs: number;
  readonly #ticker: Ticker;
  #cancel: (() => void) | undefined;

  constructor(drainOnce: () => void, options?: CooperativePumpOptions) {
    this.#drainOnce = drainOnce;
    this.#intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#ticker = options?.ticker ?? defaultTicker;
  }

  get isRunning(): boolean {
    return this.#cancel !== undefined;
  }

  /** Begin pumping; a no-op while running. */
  start(): void {
    if (this.#cancel !== undefined) {
      return;
    }
    this.#cancel = this.#ticker(() => this.#drainTick(), this.#intervalMs);
  }

  /** Stop pumping; a no-op when stopped. */
  stop(): void {
    if (this.#cancel === undefined) {
      return;
    }
    this.#cancel();
    this.#cancel = undefined;
  }

  #drainTick(): void {
    try {
      this.#drainOnce();
    } catch (error) {
      // A failure draining one tick must not tear down the whole pump.
      log.error('drain tick threw', error);
    }
  }
}

/** Yields to Bun's event loop once, then runs `tick`. */
export type TickScheduler = (tick: () => void) => void;

export type AdaptiveBlockingPumpOptions = {
  /** Drain timeout (ms) after a tick that handled events; kept small for a responsive UI. Default 8. */
  readonly minTimeoutMs?: number;
  /** Drain timeout (ms) an idle run backs off to; larger sleeps deeper for less CPU. Default 125. */
  readonly maxTimeoutMs?: number;
  /** Schedules the next tick after yielding to Bun's loop. Defaults to `setTimeout(tick, 0)`. */
  readonly schedule?: TickScheduler;
};

const DEFAULT_MIN_TIMEOUT_MS = 8;
const DEFAULT_MAX_TIMEOUT_MS = 125;

const defaultScheduler: TickScheduler = (tick) => {
  setTimeout(tick, 0);
};

/**
 * Drives a drain that blocks until a UI event or its timeout (D047): the timeout
 * resets to the minimum after a busy tick and doubles toward the maximum while idle.
 */
export class AdaptiveBlockingPump {
  readonly #drain: (timeoutMs: number) => boolean;
  readonly #minTimeoutMs: number;
  readonly #maxTimeoutMs: number;
  readonly #schedule: TickScheduler;
  #timeoutMs: number;
  #running = false;
  /** Bumped by stop(), so a tick scheduled before a stop()/start() pair dies. */
  #generation = 0;

  constructor(drain: (timeoutMs: number) => boolean, options?: AdaptiveBlockingPumpOptions) {
    this.#drain = drain;
    this.#minTimeoutMs = options?.minTimeoutMs ?? DEFAULT_MIN_TIMEOUT_MS;
    this.#maxTimeoutMs = options?.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
    this.#schedule = options?.schedule ?? defaultScheduler;
    this.#timeoutMs = this.#minTimeoutMs;
  }

  get isRunning(): boolean {
    return this.#running;
  }

  /** The drain timeout (ms) the next tick will use. */
  get timeoutMs(): number {
    return this.#timeoutMs;
  }

  /** Begin pumping; a no-op while running. */
  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#tick(this.#generation);
  }

  /** Stop pumping; a no-op when stopped. */
  stop(): void {
    this.#running = false;
    this.#generation += 1;
  }

  #tick(generation: number): void {
    if (generation !== this.#generation) {
      return;
    }
    let active = false;
    try {
      active = this.#drain(this.#timeoutMs);
    } catch (error) {
      // A failure draining one tick must not tear down the whole pump.
      log.error('drain tick threw', error);
    }
    this.#timeoutMs = active
      ? this.#minTimeoutMs
      : Math.min(this.#timeoutMs * 2, this.#maxTimeoutMs);
    this.#schedule(() => this.#tick(generation));
  }
}
