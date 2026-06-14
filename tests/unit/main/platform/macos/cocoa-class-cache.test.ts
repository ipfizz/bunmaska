import { beforeEach, describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../../../src/common/errors';
import {
  type ClassResolver,
  ClassCache,
  type ObjcClass,
} from '../../../../../src/main/platform/macos/cocoa-class-cache';

const makeCountingResolver = (): {
  resolver: ClassResolver;
  calls: ReadonlyArray<string>;
} => {
  const calls: string[] = [];
  const resolver: ClassResolver = (name) => {
    calls.push(name);
    return BigInt(calls.length);
  };
  return { resolver, calls };
};

describe('ClassCache.get', () => {
  test('calls the resolver once for a new name', () => {
    const { resolver, calls } = makeCountingResolver();
    const cache = new ClassCache(resolver);

    cache.get('NSWindow');

    expect(calls).toEqual(['NSWindow']);
  });

  test('returns the cached class on the second call without re-invoking the resolver', () => {
    const { resolver, calls } = makeCountingResolver();
    const cache = new ClassCache(resolver);

    const first = cache.get('NSWindow');
    const second = cache.get('NSWindow');

    expect(second).toBe(first);
    expect(calls).toEqual(['NSWindow']);
  });

  test('caches independently per name', () => {
    const { resolver, calls } = makeCountingResolver();
    const cache = new ClassCache(resolver);

    const win = cache.get('NSWindow');
    const app = cache.get('NSApplication');
    const winAgain = cache.get('NSWindow');

    expect(win).toBe(winAgain);
    expect(win).not.toBe(app);
    expect(calls).toEqual(['NSWindow', 'NSApplication']);
  });

  test('throws BunmaskaError when the resolver returns 0n', () => {
    const nullResolver: ClassResolver = () => 0n;
    const cache = new ClassCache(nullResolver);

    expect(() => cache.get('MissingClass')).toThrow(BunmaskaError);
    expect(() => cache.get('MissingClass')).toThrow(/Objective-C class not found: MissingClass/);
  });

  test('does not cache NULL results — a later successful lookup wins', () => {
    let count = 0;
    const resolver: ClassResolver = () => {
      count += 1;
      return count === 1 ? 0n : 99n;
    };
    const cache = new ClassCache(resolver);

    expect(() => cache.get('LateLoaded')).toThrow(BunmaskaError);
    expect(cache.get('LateLoaded')).toBe(99n);
    expect(count).toBe(2);
  });
});

describe('ClassCache.has', () => {
  test('returns false for an unseen name', () => {
    const { resolver } = makeCountingResolver();
    expect(new ClassCache(resolver).has('NSWindow')).toBe(false);
  });

  test('returns true after a successful get', () => {
    const { resolver } = makeCountingResolver();
    const cache = new ClassCache(resolver);
    cache.get('NSWindow');
    expect(cache.has('NSWindow')).toBe(true);
  });

  test('remains false after a failed (NULL) lookup', () => {
    const nullResolver: ClassResolver = () => 0n;
    const cache = new ClassCache(nullResolver);
    expect(() => cache.get('MissingClass')).toThrow(BunmaskaError);
    expect(cache.has('MissingClass')).toBe(false);
  });
});

describe('ClassCache.size', () => {
  let cache: ClassCache;

  beforeEach(() => {
    cache = new ClassCache(makeCountingResolver().resolver);
  });

  test('is 0 on a fresh cache', () => {
    expect(cache.size).toBe(0);
  });

  test('grows by 1 per distinct successful lookup', () => {
    cache.get('NSWindow');
    cache.get('NSApplication');
    cache.get('NSString');
    expect(cache.size).toBe(3);
  });

  test('does not grow for repeated names', () => {
    cache.get('NSWindow');
    cache.get('NSWindow');
    cache.get('NSWindow');
    expect(cache.size).toBe(1);
  });
});

describe('ClassCache.clear', () => {
  test('removes all cached entries', () => {
    const { resolver } = makeCountingResolver();
    const cache = new ClassCache(resolver);
    cache.get('NSWindow');
    cache.get('NSApplication');

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.has('NSWindow')).toBe(false);
  });

  test('a subsequent get re-invokes the resolver', () => {
    const { resolver, calls } = makeCountingResolver();
    const cache = new ClassCache(resolver);
    cache.get('NSWindow');
    cache.clear();
    cache.get('NSWindow');
    expect(calls).toEqual(['NSWindow', 'NSWindow']);
  });
});

describe('ObjcClass type', () => {
  test('is the bigint returned by the resolver', () => {
    const { resolver } = makeCountingResolver();
    const cache = new ClassCache(resolver);
    const cls: ObjcClass = cache.get('NSWindow');
    expect(typeof cls).toBe('bigint');
  });
});
