import { EventEmitter } from 'node:events';
import { currentPlatform } from '../../common/platform';
import { observePowerEvents as linuxObservePowerEvents } from '../platform/linux/linux-power-monitor';
import {
  observePowerEvents as macosObservePowerEvents,
  type PowerEventHandlers,
} from '../platform/macos/cocoa-power';
import { observePowerEvents as windowsObservePowerEvents } from '../platform/windows/windows-power-monitor';

/**
 * System power + screen-lock events — a drop-in subset of Electron's
 * `powerMonitor`.
 *
 * An {@link EventEmitter} (D023) emitting `suspend`, `resume`, `lock-screen` and
 * `unlock-screen`. {@link PowerMonitorImpl.startObserving} (wired once at startup
 * by the bootstrap) attaches the native hooks: on macOS, NSWorkspace sleep/wake +
 * the distributed screen-lock notifications (via the shared observer, D034); on
 * Linux, systemd-logind's `PrepareForSleep` + session `Lock`/`Unlock` D-Bus signals
 * over the deadlock-safe GDBus subscription primitive (gated behind
 * `BUNMASKA_ENABLE_LINUX_POWER`; a clean no-op when there is no system bus).
 *
 * Idle-time / on-battery queries (IOKit / UPower) are a separate follow-up.
 */

const observePower = (handlers: PowerEventHandlers): void => {
  const platform = currentPlatform();
  if (platform === 'macos') {
    macosObservePowerEvents(handlers);
  } else if (platform === 'linux') {
    linuxObservePowerEvents(handlers);
  } else if (platform === 'windows') {
    windowsObservePowerEvents(handlers);
  }
};

export class PowerMonitorImpl extends EventEmitter {
  #observing = false;

  /**
   * Begin emitting power events (idempotent — only the first call attaches the
   * native observers). `observe` is injectable so the wiring is unit-testable
   * without touching native APIs.
   */
  startObserving(observe: (handlers: PowerEventHandlers) => void = observePower): void {
    if (this.#observing) {
      return;
    }
    this.#observing = true;
    observe({
      onSuspend: () => {
        this.emit('suspend');
      },
      onResume: () => {
        this.emit('resume');
      },
      onLockScreen: () => {
        this.emit('lock-screen');
      },
      onUnlockScreen: () => {
        this.emit('unlock-screen');
      },
    });
  }

  /** Reset the observe-once guard. Test-only. */
  resetObservingForTesting(): void {
    this.#observing = false;
  }
}

/** The system power monitor singleton. Drop-in equivalent of Electron's `powerMonitor`. */
export const powerMonitor = new PowerMonitorImpl();
export type PowerMonitor = PowerMonitorImpl;
