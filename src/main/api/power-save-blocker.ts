import { currentPlatform } from '../../common/platform';
import { linuxPowerSaveBlockerBackend } from '../platform/linux/linux-power-save-blocker';
import { cocoaPowerSaveBlockerBackend } from '../platform/macos/cocoa-power-save-blocker';
import { windowsPowerSaveBlockerBackend } from '../platform/windows/windows-power-save-blocker';

/**
 * Block system/display sleep — a drop-in subset of Electron's `powerSaveBlocker`.
 *
 * The Linux leg holds an `org.freedesktop.ScreenSaver` inhibition cookie over the
 * deadlock-safe bounded GDBus method-call primitive, gated behind
 * `BUNMASKA_ENABLE_LINUX_POWER_BLOCKER` and a clean no-op with no session bus.
 *
 * NO-MECHANISM SEMANTICS, matching Electron: when `acquire` returns null —
 * headless CI, or the gate is off — `start()` STILL returns a real id and the
 * block is a documented no-op. Callers never get -1.
 */

export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

/** Opaque and platform-owned: a CFTypeRef id, a D-Bus cookie, … */
export type NativeBlocker = unknown;

/**
 * `acquire` returns null when no mechanism is available, making the block a
 * no-op; `release` is best-effort and must never throw.
 */
export type PowerSaveBlockerBackend = {
  acquire: (type: PowerSaveBlockerType) => NativeBlocker | null;
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

  /**
   * ALWAYS returns a real id, even with no native mechanism. Ids are unique for
   * the process lifetime and never reused.
   */
  start(type: PowerSaveBlockerType): number {
    const id = this.#nextId++;
    let nativeHandle: NativeBlocker | null = null;
    try {
      nativeHandle = this.#backend.acquire(type);
    } catch {
      nativeHandle = null; // acquire must never take down the caller; treat as a no-op.
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

  /** Clears every blocker WITHOUT releasing natively. @internal */
  resetForTesting(): void {
    this.#blockers.clear();
    this.#nextId = 1;
  }
}

/** The power-save-blocker singleton — Electron's `powerSaveBlocker`. */
export const powerSaveBlocker = new PowerSaveBlockerImpl();
export type PowerSaveBlocker = PowerSaveBlockerImpl;
