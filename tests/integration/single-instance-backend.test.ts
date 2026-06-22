import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodePayload,
  type SecondInstancePayload,
  SingleInstanceManager,
} from '../../src/main/api/single-instance';
import { createLockBackend } from '../../src/main/api/single-instance-backend';

/**
 * Exercises the REAL filesystem pidfile + Bun unix-socket backend (pure Bun, so
 * it runs on macOS, Linux AND Windows — Bun's AF_UNIX works on Win10+). The
 * decision logic itself is unit-tested with a fake backend in
 * single-instance.test.ts. NOTE: on Windows an AF_UNIX bind is not a visible
 * filesystem file, so the socket-file assertion below is guarded accordingly.
 */

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('createLockBackend — pidfile', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-lock-'));
    lockPath = join(dir, 'app.lock');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('tryCreateLock is atomic: succeeds once, fails while held', () => {
    const backend = createLockBackend();
    expect(backend.tryCreateLock(lockPath, process.pid)).toBe(true);
    expect(backend.tryCreateLock(lockPath, process.pid)).toBe(false);
  });

  test('readLockPid returns the recorded pid', () => {
    const backend = createLockBackend();
    backend.tryCreateLock(lockPath, 4321);
    expect(backend.readLockPid(lockPath)).toBe(4321);
  });

  test('readLockPid returns undefined when the lock is absent', () => {
    expect(createLockBackend().readLockPid(lockPath)).toBeUndefined();
  });

  test('isAlive is true for this process and false for a dead pid', () => {
    const backend = createLockBackend();
    expect(backend.isAlive(process.pid)).toBe(true);
    // pid 2^31-1 is effectively never a live process.
    expect(backend.isAlive(2147483646)).toBe(false);
  });

  test('clearLock removes the lock file', () => {
    const backend = createLockBackend();
    backend.tryCreateLock(lockPath, process.pid);
    backend.clearLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('createLockBackend — socket hand-off', () => {
  let dir: string;
  let socketPath: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-sock-'));
    socketPath = join(dir, 'app.sock');
    lockPath = join(dir, 'app.lock');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('a notify() message is delivered to the server', async () => {
    const backend = createLockBackend();
    const received: string[] = [];
    backend.startServer(socketPath, (json) => received.push(json));
    await delay(50);

    const message = encodePayload({ argv: ['x', 'y'], cwd: '/work', additionalData: { n: 7 } });
    backend.notify(socketPath, message);

    for (let i = 0; i < 40 && received.length === 0; i += 1) {
      await delay(25);
    }
    backend.stop(lockPath, socketPath);
    expect(received).toEqual([message]);
  });

  test('stop() removes the socket + lock files', async () => {
    const backend = createLockBackend();
    backend.tryCreateLock(lockPath, process.pid);
    backend.startServer(socketPath, () => undefined);
    await delay(50);
    // macOS/Linux expose the AF_UNIX bind as a visible socket file; Bun's Windows
    // AF_UNIX binding is not a filesystem entry, so only assert the socket-file
    // lifecycle where it is observable. The lock file exists on every platform.
    const socketIsVisibleFile = existsSync(socketPath);
    backend.stop(lockPath, socketPath);
    if (socketIsVisibleFile) {
      expect(existsSync(socketPath)).toBe(false);
    }
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('SingleInstanceManager over the real backend (end-to-end)', () => {
  let dir: string;
  let lockPath: string;
  let socketPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-si-e2e-'));
    lockPath = join(dir, 'SingletonLock');
    socketPath = join(dir, 'SingletonSocket');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('a secondary hands its argv to the primary over the real socket', async () => {
    const received: SecondInstancePayload[] = [];
    const primary = new SingleInstanceManager(createLockBackend(), {
      lockPath,
      socketPath,
      pid: process.pid,
    });
    expect(
      primary.request({ argv: ['primary'], cwd: '/p', additionalData: undefined }, (p) =>
        received.push(p),
      ),
    ).toBe(true);

    // A different pid so the secondary takes the notify path (not stale reclaim);
    // `isAlive` is checked against the primary's recorded (live) pid.
    const secondary = new SingleInstanceManager(createLockBackend(), {
      lockPath,
      socketPath,
      pid: process.pid + 1,
    });
    const payload: SecondInstancePayload = {
      argv: ['secondary', '--flag'],
      cwd: '/s',
      additionalData: { n: 9 },
    };
    expect(secondary.request(payload, () => undefined)).toBe(false);

    for (let i = 0; i < 80 && received.length === 0; i += 1) {
      await delay(25);
    }
    primary.release();
    expect(received).toEqual([payload]);
  });
});
