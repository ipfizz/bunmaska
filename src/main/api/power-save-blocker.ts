import { currentPlatform } from '../../common/platform';
import { app } from './app';
import { linuxPowerSaveBlockerBackend } from '../platform/linux/linux-power-save-blocker';
import { cocoaPowerSaveBlockerBackend } from '../platform/macos/cocoa-power-save-blocker';
import { windowsPowerSaveBlockerBackend } from '../platform/windows/windows-power-save-blocker';

export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

/** Opaque and platform-owned, e.g. an IOPMAssertion id or a D-Bus cookie. */
export type NativeBlocker = unknown;

/** `acquire` returns null without a mechanism (the block is then a no-op); `release` is best-effort. */
export type PowerSaveBlockerBackend = {
  /** `appName` is `app.getName()`, for backends that name the inhibitor. */
  acquire: (type: PowerSaveBlockerType, appName?: string) => NativeBlocker | null;
  release: (handle: NativeBlocker) => void;
};

const noopBackend: PowerSaveBlockerBackend = {
  acquire: () => null,
  release: () => undefined,
};

const platformBackend = (): PowerSaveBlockerBackend => {
  const platform = currentPlatform();
  if (platform === 'macos') {
    return cocoaPowerSaveBlockerBackend;
  }
  if (platform === 'linux') {
    return linuxPowerSaveBlockerBackend;
  }
  if (platform === 'windows') {
    return windowsPowerSaveBlockerBackend;
  }
  return noopBackend;
};

type Entry = { readonly type: PowerSaveBlockerType; readonly nativeHandle: NativeBlocker | null };

export class PowerSaveBlockerImpl {
  readonly #backend: PowerSaveBlockerBackend;
  readonly #blockers = new Map<number, Entry>();
  #nextId = 1;

  constructor(backend: PowerSaveBlockerBackend = platformBackend()) {
    this.#backend = backend;
  }

  /** A fresh, never-reused id even with no mechanism (Linux without its gate, D038), as in Electron. */
  start(type: PowerSaveBlockerType): number {
    const id = this.#nextId++;
    let nativeHandle: NativeBlocker | null = null;
    try {
      nativeHandle = this.#backend.acquire(type, app.getName());
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
        this.#backend.release(entry.nativeHandle);
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
