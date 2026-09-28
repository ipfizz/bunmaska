import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentPlatform } from '../../src/common/platform';
import {
  encodePayload,
  type SecondInstancePayload,
  SingleInstanceManager,
} from '../../src/main/api/single-instance';
import { createLockBackend } from '../../src/main/api/single-instance-backend';

// The real pidfile + unix-socket backend; pure Bun, so it runs on every OS (AF_UNIX needs Win10+).

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

  /** Run `body` in a child Bun process with `backend` = a fresh live backend. */
  const runChild = (body: string): number | null => {
    const backendModule = join(import.meta.dir, '../../src/main/api/single-instance-backend.ts');
    const script = [
      `import { writeFileSync } from 'node:fs';`,
      `import { createLockBackend } from ${JSON.stringify(backendModule)};`,
      'const backend = createLockBackend();',
      `const lockPath = ${JSON.stringify(lockPath)};`,
      body,
      'process.exit(0);',
    ].join('\n');
    return Bun.spawnSync([process.execPath, '-e', script]).exitCode;
  };

  test('a lock still held when the process exits is removed', () => {
    expect(runChild('backend.tryCreateLock(lockPath, process.pid);')).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
  });

  test("exit leaves alone a lock another instance took after this one's release", () => {
    const body = [
      'backend.tryCreateLock(lockPath, process.pid);',
      `backend.stop(lockPath, lockPath + '.sock');`,
      `writeFileSync(lockPath, '1');`,
    ].join('\n');
    expect(runChild(body)).toBe(0);
    expect(existsSync(lockPath)).toBe(true);
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

    const message = encodePayload({ argv: ['x', 'y'], cwd: '/work', additionalData: { n: 7 } });
    backend.notify(socketPath, message);

    for (let i = 0; i < 40 && received.length === 0; i += 1) {
      await delay(25);
    }
    backend.stop(lockPath, socketPath);
    expect(received).toEqual([message]);
  });

  test('stop() removes the lock file', () => {
    const backend = createLockBackend();
    backend.tryCreateLock(lockPath, process.pid);
    backend.startServer(socketPath, () => undefined);
    backend.stop(lockPath, socketPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  // Bun's Windows AF_UNIX bind is not a filesystem entry.
  test.skipIf(currentPlatform() === 'windows')('stop() removes the socket file', () => {
    const backend = createLockBackend();
    backend.startServer(socketPath, () => undefined);
    expect(existsSync(socketPath)).toBe(true);
    backend.stop(lockPath, socketPath);
    expect(existsSync(socketPath)).toBe(false);
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
