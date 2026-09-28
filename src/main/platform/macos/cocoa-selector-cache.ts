export type Selector = bigint;

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

  get size(): number {
    return this.#cache.size;
  }
}
