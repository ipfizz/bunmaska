import { describe, expect, test } from 'bun:test';
import {
  type NativeBlocker,
  PowerSaveBlockerImpl,
  type PowerSaveBlockerBackend,
  type PowerSaveBlockerType,
} from '../../../../src/main/api/power-save-blocker';

/** A fake backend recording acquire/release calls and handing out tagged handles. */
const makeFakeBackend = (
  acquireResult: (type: PowerSaveBlockerType) => NativeBlocker | null = () => ({ tag: 'h' }),
): {
  backend: PowerSaveBlockerBackend;
  acquires: () => PowerSaveBlockerType[];
  releases: () => NativeBlocker[];
} => {
  const acquires: PowerSaveBlockerType[] = [];
  const releases: NativeBlocker[] = [];
  return {
    acquires: () => acquires,
    releases: () => releases,
    backend: {
      acquire: (type) => {
        acquires.push(type);
        return acquireResult(type);
      },
      release: (handle) => {
        releases.push(handle);
      },
    },
  };
};

describe('PowerSaveBlocker registry', () => {
  test('start returns unique incrementing ids; isStarted/stop track them', () => {
    const { backend } = makeFakeBackend();
    const psb = new PowerSaveBlockerImpl(backend);
    const a = psb.start('prevent-app-suspension');
    const b = psb.start('prevent-display-sleep');
    expect(a).not.toBe(b);
    expect(psb.isStarted(a)).toBe(true);
    expect(psb.isStarted(b)).toBe(true);
    expect(psb.stop(a)).toBe(true);
    expect(psb.isStarted(a)).toBe(false);
    expect(psb.isStarted(b)).toBe(true);
  });

  test('double-stop and unknown-id stop return false', () => {
    const { backend } = makeFakeBackend();
    const psb = new PowerSaveBlockerImpl(backend);
    const id = psb.start('prevent-display-sleep');
    expect(psb.stop(id)).toBe(true);
    expect(psb.stop(id)).toBe(false);
    expect(psb.stop(9999)).toBe(false);
  });

  test('acquire is called with the type; release with the exact handle, once each', () => {
    const { backend, acquires, releases } = makeFakeBackend(() => ({ cookie: 42 }));
    const psb = new PowerSaveBlockerImpl(backend);
    const id = psb.start('prevent-app-suspension');
    psb.stop(id);
    expect(acquires()).toEqual(['prevent-app-suspension']);
    expect(releases()).toEqual([{ cookie: 42 }]);
  });

  test('a null acquire still yields a real id, and release is NOT called on stop', () => {
    const { backend, releases } = makeFakeBackend(() => null);
    const psb = new PowerSaveBlockerImpl(backend);
    const id = psb.start('prevent-app-suspension');
    expect(id).toBeGreaterThan(0);
    expect(psb.isStarted(id)).toBe(true);
    expect(psb.stop(id)).toBe(true);
    expect(releases()).toEqual([]); // nothing native to release
  });

  test('an acquire that throws still returns an id and never throws out', () => {
    const psb = new PowerSaveBlockerImpl({
      acquire: () => {
        throw new Error('native failure');
      },
      release: () => undefined,
    });
    let id = 0;
    expect(() => {
      id = psb.start('prevent-display-sleep');
    }).not.toThrow();
    expect(psb.isStarted(id)).toBe(true);
    expect(psb.stop(id)).toBe(true);
  });
});
