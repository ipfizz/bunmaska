/**
 * A strongly-typed event emitter.
 *
 * Generic over an event map of the form `{ eventName: readonly [arg1, arg2, ...] }`.
 * Callers cannot register a handler with the wrong signature, and `emit` rejects
 * mismatched payloads at compile time.
 *
 * @example
 * ```ts
 * type Events = {
 *   ready: readonly [];
 *   click: readonly [x: number, y: number];
 * };
 * const e = new TypedEmitter<Events>();
 * e.on('click', (x, y) => console.log(x + y));
 * e.emit('click', 3, 4);
 * ```
 */

export type EventMap = Record<string, readonly unknown[]>;

export type Listener<Args extends readonly unknown[]> = (...args: Args) => void;

type AnyListener = (...args: readonly unknown[]) => void;

export class TypedEmitter<Events extends EventMap> {
  readonly #listeners = new Map<keyof Events, Set<AnyListener>>();

  on<E extends keyof Events>(event: E, listener: Listener<Events[E]>): this {
    const existing = this.#listeners.get(event);
    const set = existing ?? new Set<AnyListener>();
    set.add(listener as AnyListener);
    if (existing === undefined) {
      this.#listeners.set(event, set);
    }
    return this;
  }

  off<E extends keyof Events>(event: E, listener: Listener<Events[E]>): this {
    this.#listeners.get(event)?.delete(listener as AnyListener);
    return this;
  }

  once<E extends keyof Events>(event: E, listener: Listener<Events[E]>): this {
    const wrapper = ((...args: Events[E]): void => {
      this.off(event, wrapper);
      listener(...args);
    }) as Listener<Events[E]>;
    return this.on(event, wrapper);
  }

  emit<E extends keyof Events>(event: E, ...args: Events[E]): boolean {
    const set = this.#listeners.get(event);
    if (set === undefined || set.size === 0) {
      return false;
    }
    for (const listener of [...set]) {
      (listener as Listener<Events[E]>)(...args);
    }
    return true;
  }

  listenerCount<E extends keyof Events>(event: E): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  removeAllListeners<E extends keyof Events>(event?: E): this {
    if (event === undefined) {
      this.#listeners.clear();
    } else {
      this.#listeners.delete(event);
    }
    return this;
  }
}
