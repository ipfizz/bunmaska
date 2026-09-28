import { EventEmitter } from 'node:events';
import { service } from '../platform/index';
import type { PowerEventHandlers } from '../platform/services';

const { get: getObserver } = service('powerMonitor');

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
  observe: (handlers: PowerEventHandlers) => void = (handlers) => getObserver()(handlers),
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
