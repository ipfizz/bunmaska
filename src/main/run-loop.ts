import { createLogger } from '../common/logger';

/**
 * Cooperative run-loop pump.
 *
 * Bun owns the main thread and its event loop; native UI toolkits (AppKit,
 * GTK) need their own run loop pumped to process window events and render.
 * Rather than blocking the thread (which crashes Bun — see D019/D020), we lend
 * the thread to the native loop for a non-blocking drain on a fast timer.
 *
 * This class is the platform-neutral control half: it owns start/stop and the
 * tick scheduling. The actual native drain (`CFRunLoopRunInMode` on macOS,
 * `g_main_context_iteration` on Linux) is injected as {@link drainOnce}, and
 * the timer is injected as a {@link Ticker} so the logic is unit-testable
 * without any FFI.
 */

const log = createLogger('run-loop');

/** Schedules `onTick` every `intervalMs` and returns a cancel function. */
export type Ticker = (onTick: () => void, intervalMs: number) => () => void;

export type CooperativePumpOptions = {
  /** Milliseconds between drains. Lower = smoother UI, more CPU. Default 16 (~60Hz). */
  readonly intervalMs?: number;
  /** Timer source; defaults to `setInterval`/`clearInterval`. Injected in tests. */
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

  /** Begin pumping. Idempotent — a second call while running is a no-op. */
  start(): void {
    if (this.#cancel !== undefined) {
      return;
    }
    this.#cancel = this.#ticker(() => this.#drainTick(), this.#intervalMs);
  }

  /** Stop pumping. Idempotent — safe to call when not running. */
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

/** Yields to Bun's event loop once, then runs `tick`. Injected in tests. */
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
 * Adaptive blocking run-loop pump.
 *
 * Drives a native drain that sleeps until a UI event or a timeout (see the
 * platform `createDrain`). Each tick the drain blocks for the current timeout
 * and reports whether it handled events; the pump then resets the timeout to
 * its minimum (input is flowing — stay responsive) or doubles it toward the
 * maximum (idle — sleep deeper for near-zero CPU). Between ticks it yields to
 * Bun's loop so JS timers, microtasks and IO run. A UI event wakes the drain
 * immediately, so input latency stays ~0 regardless of the idle backoff.
 */
export class AdaptiveBlockingPump {
  readonly #drain: (timeoutMs: number) => boolean;
  readonly #minTimeoutMs: number;
  readonly #maxTimeoutMs: number;
  readonly #schedule: TickScheduler;
  #timeoutMs: number;
  #running = false;

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

  /** Begin pumping. Idempotent — a second call while running is a no-op. */
  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#tick();
  }

  /** Stop pumping. Idempotent — safe to call when not running. */
  stop(): void {
    this.#running = false;
  }

  #tick(): void {
    if (!this.#running) {
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
    this.#schedule(() => this.#tick());
  }
}
