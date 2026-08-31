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
 * `powerMonitor`. An {@link EventEmitter} (D023) emitting `suspend`, `resume`,
 * `lock-screen` and `unlock-screen`. macOS screen-lock rides the shared
 * distributed observer (D034); the Linux logind leg is gated behind
 * `BUNMASKA_ENABLE_LINUX_POWER` and no-ops without a system bus.
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

  /** Idempotent: only the first call attaches the native observers. */
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

  /** @internal */
  resetObservingForTesting(): void {
    this.#observing = false;
  }
}

/** The system power monitor singleton — Electron's `powerMonitor`. */
export const powerMonitor = new PowerMonitorImpl();
export type PowerMonitor = PowerMonitorImpl;
