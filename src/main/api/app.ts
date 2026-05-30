import { EventEmitter } from 'node:events';

/**
 * Application lifecycle controller — the drop-in equivalent of Electron's `app`.
 *
 * Extends Node's {@link EventEmitter} so the full listener API
 * (`on`/`once`/`addListener`/`removeListener`/`emit`/…) matches Electron's
 * contract (D023). Events: `ready`, `before-quit`, `will-quit`,
 * `window-all-closed`, `quit`.
 *
 * The class is kept free of any native dependency so it unit-tests without FFI:
 * the native bootstrap is supplied as an injectable hook ({@link setStartHook})
 * by the runtime barrel, not imported here.
 */
export class App extends EventEmitter {
  #ready = false;
  #startHook: (() => void) | undefined;

  /** Whether the `ready` event has already fired. */
  get isReady(): boolean {
    return this.#ready;
  }

  /**
   * Resolves once the app is ready to create windows. The first call triggers
   * the native bootstrap (if a start hook is wired); resolves immediately if
   * the app is already ready.
   */
  whenReady(): Promise<void> {
    if (!this.#ready) {
      this.#startHook?.();
    }
    if (this.#ready) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.once('ready', () => resolve());
    });
  }

  /**
   * Mark the app ready and emit `ready`. Idempotent.
   * @internal Invoked by the native bootstrap once the runtime is up.
   */
  markReady(): void {
    if (this.#ready) {
      return;
    }
    this.#ready = true;
    this.emit('ready');
  }

  /**
   * Register the native bootstrap to run on the first {@link whenReady}.
   * @internal Wired by the runtime barrel; never called by app code.
   */
  setStartHook(hook: () => void): void {
    this.#startHook = hook;
  }

  /**
   * Begin shutting the app down: emit `before-quit` then `will-quit`, then
   * `quit`. The native bootstrap listens for these to stop the run loop.
   */
  quit(): void {
    this.emit('before-quit');
    this.emit('will-quit');
    this.emit('quit');
  }
}

/** The application lifecycle singleton. Drop-in equivalent of Electron's `app`. */
export const app = new App();
