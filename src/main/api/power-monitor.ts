import { EventEmitter } from 'node:events';
import { currentPlatform } from '../../common/platform';
import { observePowerEvents as linuxObservePowerEvents } from '../platform/linux/linux-power-monitor';
import { observePowerEvents as macosObservePowerEvents } from '../platform/macos/cocoa-power';
import type { PowerEventHandlers } from '../platform/services';
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
export class PowerMonitorImpl extends EventEmitter {}

export const powerMonitor = new PowerMonitorImpl();
export type PowerMonitor = PowerMonitorImpl;

let observing = false;

/** Called once from bootstrap `onReady` (D034); later calls are no-ops. @internal */
export const startPowerMonitorObserving = (
  observe: (handlers: PowerEventHandlers) => void = observePower,
): void => {
  if (observing) {
    return;
  }
  observing = true;
  observe({
    onSuspend: () => {
      powerMonitor.emit('suspend');
    },
    onResume: () => {
      powerMonitor.emit('resume');
    },
    onLockScreen: () => {
      powerMonitor.emit('lock-screen');
    },
    onUnlockScreen: () => {
      powerMonitor.emit('unlock-screen');
    },
  });
};

/** @internal */
export const resetPowerMonitorObservingForTesting = (): void => {
  observing = false;
};
