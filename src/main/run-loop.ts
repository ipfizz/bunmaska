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
