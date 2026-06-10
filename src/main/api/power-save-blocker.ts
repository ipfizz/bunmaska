import { currentPlatform } from '../../common/platform';
import { linuxPowerSaveBlockerBackend } from '../platform/linux/linux-power-save-blocker';
import { cocoaPowerSaveBlockerBackend } from '../platform/macos/cocoa-power-save-blocker';

/**
 * Block system/display sleep — a drop-in subset of Electron's `powerSaveBlocker`.
 *
 * A start/stop REGISTRY (not an emitter): {@link PowerSaveBlockerImpl.start} takes a
 * blocker `type`, asks the platform backend to {@link PowerSaveBlockerBackend.acquire} a
 * native blocker, stores it under a fresh incrementing id, and returns that id;
 * {@link PowerSaveBlockerImpl.stop} releases the native blocker and forgets the id.
 *
 * Backends: macOS holds an IOKit `IOPMAssertion` (synchronous, no run loop); Linux holds
 * an `org.freedesktop.ScreenSaver` inhibition cookie over the deadlock-safe bounded GDBus
 * method-call primitive (gated behind `SAMBAR_ENABLE_LINUX_POWER_BLOCKER`; a clean no-op
 * when there is no session bus).
 *
 * NO-MECHANISM SEMANTICS (matches Electron, which "always returns an integer identifying
 * the power save blocker"): when {@link PowerSaveBlockerBackend.acquire} returns null (no
 * native mechanism — headless CI, or the gate is off), `start()` STILL returns a real id;
 * the block is simply a documented no-op (`isStarted` true, `stop` true, nothing native to
 * release). Callers never get -1.
 */

/** Electron's two power-save-blocker types. */
export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

/** An opaque, platform-owned native blocker handle (a CFTypeRef id, a D-Bus cookie, …). */
export type NativeBlocker = unknown;

/**
 * The native operations the registry drives — injectable so the id-bookkeeping is
 * unit-tested with a fake (no FFI). `acquire` returns null when no mechanism is available
 * (the block becomes a no-op); `release` is best-effort and never throws.
 */
export type PowerSaveBlockerBackend = {
  acquire: (type: PowerSaveBlockerType) => NativeBlocker | null;
  release: (handle: NativeBlocker) => void;
};

/** A no-op backend (no native power management on this platform). */
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
  return noopBackend;
};

type Entry = { readonly type: PowerSaveBlockerType; readonly nativeHandle: NativeBlocker | null };

export class PowerSaveBlockerImpl {
  readonly #backend: PowerSaveBlockerBackend;
  readonly #blockers = new Map<number, Entry>();
  #nextId = 1;

  /** `backend` is injectable so the registry is unit-testable with a fake (no FFI). */
  constructor(backend: PowerSaveBlockerBackend = platformBackend()) {
    this.#backend = backend;
  }

  /**
   * Start a power-save blocker of `type`. Returns the blocker id (ALWAYS a real id, even
   * when no native mechanism is available — the block is then a no-op). Ids are unique for
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

  /**
   * Stop the blocker with `id`, releasing the native handle. Returns true if `id` referred
   * to a live blocker (now stopped), false for an unknown/already-stopped id.
   */
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

  /** Whether `id` refers to a currently-started blocker. */
  isStarted(id: number): boolean {
    return this.#blockers.has(id);
  }

  /** Clear every blocker without releasing natively. Test-only. */
  resetForTesting(): void {
    this.#blockers.clear();
    this.#nextId = 1;
  }
}

/** The power-save-blocker singleton. Drop-in equivalent of Electron's `powerSaveBlocker`. */
export const powerSaveBlocker = new PowerSaveBlockerImpl();
export type PowerSaveBlocker = PowerSaveBlockerImpl;
