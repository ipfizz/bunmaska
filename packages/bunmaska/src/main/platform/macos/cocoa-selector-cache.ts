/**
 * Memoising wrapper around Objective-C's `sel_registerName`.
 *
 * Calling `sel_registerName("foo:")` once is cheap. Doing it on every message
 * send is wasteful. This cache guarantees one registrar call per distinct
 * selector name for the lifetime of the cache instance.
 *
 * The registrar is injected via constructor so unit tests stay free of any
 * `bun:ffi` dependency.
 */

/** Opaque pointer-width handle returned by `sel_registerName`. */
export type Selector = bigint;

/** Shape of `sel_registerName`: name → opaque selector handle. */
export type SelectorRegistrar = (name: string) => Selector;

export class SelectorCache {
  readonly #cache = new Map<string, Selector>();
  readonly #registrar: SelectorRegistrar;

  constructor(registrar: SelectorRegistrar) {
    this.#registrar = registrar;
  }

  get(name: string): Selector {
    const existing = this.#cache.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = this.#registrar(name);
    this.#cache.set(name, fresh);
    return fresh;
  }

  has(name: string): boolean {
    return this.#cache.has(name);
  }

  get size(): number {
    return this.#cache.size;
  }

  clear(): void {
    this.#cache.clear();
  }
}
