import { EventEmitter } from 'node:events';
import { currentPlatform } from '../../common/platform';
import { observePowerEvents as linuxObservePowerEvents } from '../platform/linux/linux-power-monitor';
import {
  observePowerEvents as macosObservePowerEvents,
  type PowerEventHandlers,
} from '../platform/macos/cocoa-power';
import { observePowerEvents as windowsObservePowerEvents } from '../platform/windows/windows-power-monitor';

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

/**
 * Emits `suspend`, `resume`, `lock-screen` and `unlock-screen`. Linux listens only with
 * `BUNMASKA_ENABLE_LINUX_POWER=1` and a system bus (D037).
 */
export class PowerMonitorImpl extends EventEmitter {
  #observing = false;

  /** Called once from bootstrap `onReady` (D034); later calls are no-ops. */
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

export const powerMonitor = new PowerMonitorImpl();
export type PowerMonitor = PowerMonitorImpl;
