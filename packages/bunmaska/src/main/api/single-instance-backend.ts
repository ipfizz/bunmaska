import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../../common/logger';
import type { LockBackend } from './single-instance';

/**
 * The live {@link LockBackend}: an atomic pidfile for the primary/secondary
 * decision plus a Bun unix-domain socket for argv hand-off. Stateful — it holds
 * the listening server so {@link LockBackend.stop} can close it — so each lock
 * gets its own instance via {@link createLockBackend}.
 */

const log = createLogger('single-instance');

type UnixSocketListener = { stop(closeActiveConnections?: boolean): void };

export const createLockBackend = (): LockBackend => {
  let server: UnixSocketListener | undefined;

  const removeSocketFile = (socketPath: string): void => {
    try {
      rmSync(socketPath, { force: true });
    } catch (error) {
      log.warn('could not remove stale socket', error);
    }
  };

  return {
    tryCreateLock(lockPath, pid) {
      try {
        mkdirSync(dirname(lockPath), { recursive: true });
        // `wx` fails if the file already exists — the atomic acquire.
        writeFileSync(lockPath, String(pid), { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    },

    readLockPid(lockPath) {
      try {
        const pid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
        return Number.isInteger(pid) ? pid : undefined;
      } catch {
        return undefined;
      }
    },

    isAlive(pid) {
      try {
        // Signal 0 performs only the existence/permission check.
        process.kill(pid, 0);
        return true;
      } catch (error) {
        // EPERM means the process exists but is owned by another user — alive.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    },

    clearLock(lockPath) {
      try {
        rmSync(lockPath, { force: true });
      } catch (error) {
        log.warn('could not clear stale lock', error);
      }
    },

    startServer(socketPath, onMessage) {
      // A leftover socket file from a crashed primary would block bind.
      removeSocketFile(socketPath);
      const chunks = new WeakMap<object, Uint8Array[]>();
      server = Bun.listen<undefined>({
        unix: socketPath,
        socket: {
          open(socket) {
            chunks.set(socket, []);
          },
          data(socket, data) {
            chunks.get(socket)?.push(data);
          },
          close(socket) {
            const parts = chunks.get(socket) ?? [];
            chunks.delete(socket);
            if (parts.length > 0) {
              onMessage(Buffer.concat(parts).toString('utf8'));
            }
          },
          error(_socket, error) {
            log.warn('single-instance server socket error', error);
          },
        },
      });
    },

    notify(socketPath, json) {
      void Bun.connect<undefined>({
        unix: socketPath,
        socket: {
          open(socket) {
            socket.write(json);
            socket.end();
          },
          data() {
            // The primary does not reply.
          },
          error(_socket, error) {
            log.warn('could not notify primary instance', error);
          },
        },
      }).catch((error) => log.warn('could not connect to primary instance', error));
    },

    stop(lockPath, socketPath) {
      server?.stop(true);
      server = undefined;
      try {
        rmSync(lockPath, { force: true });
      } catch (error) {
        log.warn('could not remove lock on release', error);
      }
      removeSocketFile(socketPath);
    },
  };
};
