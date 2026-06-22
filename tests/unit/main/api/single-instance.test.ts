import { describe, expect, test } from 'bun:test';
import {
  decodePayload,
  encodePayload,
  type LockBackend,
  type SecondInstancePayload,
  SingleInstanceManager,
} from '../../../../src/main/api/single-instance';

type Calls = {
  created: number;
  cleared: number;
  servers: Array<(json: string) => void>;
  notified: string[];
  stopped: number;
};

const makeBackend = (
  opts: { acquire?: boolean[]; existingPid?: number; alive?: boolean } = {},
): { backend: LockBackend; calls: Calls } => {
  const acquireQueue = [...(opts.acquire ?? [true])];
  const calls: Calls = { created: 0, cleared: 0, servers: [], notified: [], stopped: 0 };
  const backend: LockBackend = {
    tryCreateLock: () => {
      calls.created += 1;
      return acquireQueue.shift() ?? false;
    },
    readLockPid: () => opts.existingPid,
    isAlive: () => opts.alive ?? false,
    clearLock: () => {
      calls.cleared += 1;
    },
    startServer: (_socketPath, onMessage) => {
      calls.servers.push(onMessage);
    },
    notify: (_socketPath, json) => {
      calls.notified.push(json);
    },
    stop: () => {
      calls.stopped += 1;
    },
  };
  return { backend, calls };
};

const PAYLOAD: SecondInstancePayload = { argv: ['a', 'b'], cwd: '/x', additionalData: { k: 1 } };
const PATHS = { lockPath: '/tmp/app.lock', socketPath: '/tmp/app.sock', pid: 100 };

describe('encode/decode payload', () => {
  test('round-trips argv, cwd, and additionalData', () => {
    const decoded = decodePayload(encodePayload(PAYLOAD));
    expect(decoded).toEqual(PAYLOAD);
  });

  test('decode returns undefined on malformed JSON', () => {
    expect(decodePayload('{not json')).toBeUndefined();
  });

  test('decode returns undefined when argv is missing', () => {
    expect(decodePayload(JSON.stringify({ cwd: '/x' }))).toBeUndefined();
  });
});

describe('SingleInstanceManager.request', () => {
  test('acquires the lock and starts the server as primary', () => {
    const { backend, calls } = makeBackend({ acquire: [true] });
    const mgr = new SingleInstanceManager(backend, PATHS);
    expect(mgr.request(PAYLOAD, () => undefined)).toBe(true);
    expect(mgr.has()).toBe(true);
    expect(calls.servers).toHaveLength(1);
  });

  test('is idempotent once primary', () => {
    const { backend, calls } = makeBackend({ acquire: [true] });
    const mgr = new SingleInstanceManager(backend, PATHS);
    mgr.request(PAYLOAD, () => undefined);
    expect(mgr.request(PAYLOAD, () => undefined)).toBe(true);
    expect(calls.created).toBe(1);
  });

  test('becomes secondary and notifies the live primary', () => {
    const { backend, calls } = makeBackend({ acquire: [false], existingPid: 42, alive: true });
    const mgr = new SingleInstanceManager(backend, PATHS);
    expect(mgr.request(PAYLOAD, () => undefined)).toBe(false);
    expect(mgr.has()).toBe(false);
    expect(calls.servers).toHaveLength(0);
    expect(calls.notified).toEqual([encodePayload(PAYLOAD)]);
  });

  test('reclaims a stale lock when the recorded pid is dead', () => {
    const { backend, calls } = makeBackend({
      acquire: [false, true],
      existingPid: 42,
      alive: false,
    });
    const mgr = new SingleInstanceManager(backend, PATHS);
    expect(mgr.request(PAYLOAD, () => undefined)).toBe(true);
    expect(calls.cleared).toBe(1);
    expect(calls.created).toBe(2);
    expect(mgr.has()).toBe(true);
  });

  test('delivers a decoded payload to the second-instance callback', () => {
    const { backend, calls } = makeBackend({ acquire: [true] });
    const mgr = new SingleInstanceManager(backend, PATHS);
    let received: SecondInstancePayload | undefined;
    mgr.request(PAYLOAD, (p) => {
      received = p;
    });
    calls.servers[0]?.(encodePayload(PAYLOAD));
    expect(received).toEqual(PAYLOAD);
  });

  test('ignores a malformed second-instance message', () => {
    const { backend, calls } = makeBackend({ acquire: [true] });
    const mgr = new SingleInstanceManager(backend, PATHS);
    let calledWith: SecondInstancePayload | undefined = PAYLOAD;
    mgr.request(PAYLOAD, (p) => {
      calledWith = p;
    });
    calls.servers[0]?.('garbage');
    expect(calledWith).toEqual(PAYLOAD);
  });
});

describe('SingleInstanceManager.release', () => {
  test('stops the server and drops the lock', () => {
    const { backend, calls } = makeBackend({ acquire: [true] });
    const mgr = new SingleInstanceManager(backend, PATHS);
    mgr.request(PAYLOAD, () => undefined);
    mgr.release();
    expect(calls.stopped).toBe(1);
    expect(mgr.has()).toBe(false);
  });

  test('is a no-op when not held', () => {
    const { backend, calls } = makeBackend({ acquire: [false], existingPid: 42, alive: true });
    const mgr = new SingleInstanceManager(backend, PATHS);
    mgr.request(PAYLOAD, () => undefined);
    mgr.release();
    expect(calls.stopped).toBe(0);
  });
});
