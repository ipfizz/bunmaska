import { FFIError } from '../../../common/errors';

export type ObjcClass = bigint;

/** `objc_getClass`: `0n` when the class is not registered. */
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
      // Never cache a miss: a framework loaded later may register the class.
      throw new FFIError(`Objective-C class not found: ${name}`);
    }
    this.#cache.set(name, fresh);
    return fresh;
  }

  get size(): number {
    return this.#cache.size;
  }
}
