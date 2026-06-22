import { beforeEach, describe, expect, test } from 'bun:test';
import {
  type Selector,
  SelectorCache,
  type SelectorRegistrar,
} from '../../../../../src/main/platform/macos/cocoa-selector-cache';

const makeCountingRegistrar = (): {
  registrar: SelectorRegistrar;
  calls: ReadonlyArray<string>;
} => {
  const calls: string[] = [];
  const registrar: SelectorRegistrar = (name) => {
    calls.push(name);
    return BigInt(calls.length);
  };
  return { registrar, calls };
};

describe('SelectorCache.get', () => {
  test('calls the registrar exactly once for a new name', () => {
    const { registrar, calls } = makeCountingRegistrar();
    const cache = new SelectorCache(registrar);

    cache.get('alloc');

    expect(calls).toEqual(['alloc']);
  });

  test('returns the cached selector on the second call without re-invoking the registrar', () => {
    const { registrar, calls } = makeCountingRegistrar();
    const cache = new SelectorCache(registrar);

    const first = cache.get('alloc');
    const second = cache.get('alloc');

    expect(second).toBe(first);
    expect(calls).toEqual(['alloc']);
  });

  test('caches independently per name', () => {
    const { registrar, calls } = makeCountingRegistrar();
    const cache = new SelectorCache(registrar);

    const a = cache.get('alloc');
    const b = cache.get('init');
    const a2 = cache.get('alloc');

    expect(a).toBe(a2);
    expect(a).not.toBe(b);
    expect(calls).toEqual(['alloc', 'init']);
  });

  test('preserves selector identity across many lookups', () => {
    const { registrar } = makeCountingRegistrar();
    const cache = new SelectorCache(registrar);

    const ref = cache.get('release');
    for (let i = 0; i < 100; i += 1) {
      expect(cache.get('release')).toBe(ref);
    }
  });
});

describe('SelectorCache.has', () => {
  test('returns false for an unseen name', () => {
    const { registrar } = makeCountingRegistrar();
    expect(new SelectorCache(registrar).has('alloc')).toBe(false);
  });

  test('returns true after the first get', () => {
    const { registrar } = makeCountingRegistrar();
    const cache = new SelectorCache(registrar);
    cache.get('alloc');
    expect(cache.has('alloc')).toBe(true);
  });
});

describe('SelectorCache.size', () => {
  let cache: SelectorCache;

  beforeEach(() => {
    cache = new SelectorCache(makeCountingRegistrar().registrar);
  });

  test('is 0 on a fresh cache', () => {
    expect(cache.size).toBe(0);
  });

  test('grows by 1 per distinct name', () => {
    cache.get('alloc');
    cache.get('init');
    cache.get('release');
    expect(cache.size).toBe(3);
  });

  test('does not grow for repeated names', () => {
    cache.get('alloc');
    cache.get('alloc');
    cache.get('alloc');
    expect(cache.size).toBe(1);
  });
});

describe('SelectorCache.clear', () => {
  test('removes all cached entries', () => {
    const { registrar } = makeCountingRegistrar();
    const cache = new SelectorCache(registrar);
    cache.get('alloc');
    cache.get('init');

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.has('alloc')).toBe(false);
  });

  test('a subsequent get re-invokes the registrar', () => {
    const { registrar, calls } = makeCountingRegistrar();
    const cache = new SelectorCache(registrar);
    cache.get('alloc');
    cache.clear();
    cache.get('alloc');
    expect(calls).toEqual(['alloc', 'alloc']);
  });
});

describe('Selector type', () => {
  test('is the bigint returned by the registrar', () => {
    const { registrar } = makeCountingRegistrar();
    const cache = new SelectorCache(registrar);
    const sel: Selector = cache.get('alloc');
    expect(typeof sel).toBe('bigint');
  });
});
