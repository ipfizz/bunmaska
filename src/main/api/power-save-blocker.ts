import { service } from '../platform/index';
import { app } from './app';
import type {
  NativeBlocker,
  PowerSaveBlockerBackend,
  PowerSaveBlockerType,
} from '../platform/services';

const { get: getBackend } = service('powerSaveBlocker');

type Entry = { readonly type: PowerSaveBlockerType; readonly nativeHandle: NativeBlocker | null };

export class PowerSaveBlockerImpl {
  readonly #backend: () => PowerSaveBlockerBackend;
  readonly #blockers = new Map<number, Entry>();
  #nextId = 1;

  /** Without `backend`, the OS one is resolved on first use, never at import. */
  constructor(backend?: PowerSaveBlockerBackend) {
    this.#backend = backend === undefined ? getBackend : () => backend;
  }

  /** A fresh, never-reused id even with no mechanism (Linux without its gate, D038), as in Electron. */
  start(type: PowerSaveBlockerType): number {
    const id = this.#nextId++;
    let nativeHandle: NativeBlocker | null = null;
    try {
      nativeHandle = this.#backend().acquire(type, app.getName());
    } catch {
      nativeHandle = null; // A failed acquire is a no-op block, never a throw.
    }
    this.#blockers.set(id, { type, nativeHandle });
    return id;
  }

  /** `false` for an unknown or already-stopped id. */
  stop(id: number): boolean {
    const entry = this.#blockers.get(id);
    if (entry === undefined) {
      return false;
    }
    this.#blockers.delete(id);
    if (entry.nativeHandle !== null) {
      try {
        this.#backend().release(entry.nativeHandle);
      } catch {
        // Best-effort release; the id is already forgotten.
      }
    }
    return true;
  }

  isStarted(id: number): boolean {
    return this.#blockers.has(id);
  }
}

export const powerSaveBlocker = new PowerSaveBlockerImpl();
export type PowerSaveBlocker = PowerSaveBlockerImpl;
