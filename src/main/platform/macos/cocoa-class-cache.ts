import { FFIError } from '../../../common/errors';

/**
 * Memoising wrapper around Objective-C's `objc_getClass`.
 *
 * Unlike `sel_registerName`, `objc_getClass` returns `NULL` (`0n`) when the
 * named class is not registered with the runtime. We treat that as a programmer
 * error and throw {@link BunmaskaError}, but we deliberately do NOT cache NULL
 * results — a dynamically loaded framework may register the class later, and
 * a retry should succeed.
 *
 * The resolver is injected so unit tests stay free of any `bun:ffi` dependency.
 */

/** Opaque pointer-width handle returned by `objc_getClass`. */
export type ObjcClass = bigint;

/** Shape of `objc_getClass`: name → opaque class handle (or `0n` if missing). */
export type ClassResolver = (name: string) => ObjcClass;

export class ClassCache {
  readonly #cache = new Map<string, ObjcClass>();
  readonly #resolver: ClassResolver;

  constructor(resolver: ClassResolver) {
    this.#resolver = resolver;
  }

  get(name: string): ObjcClass {
    const existing = this.#cache.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = this.#resolver(name);
    if (fresh === 0n) {
      throw new FFIError(`Objective-C class not found: ${name}`);
    }
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
