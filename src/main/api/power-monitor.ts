import { EventEmitter } from 'node:events';
import { service } from '../platform/index';
import type { PowerEventHandlers, PowerMonitorBackend, SystemIdleState } from '../platform/services';

export type { SystemIdleState };

const { get: getBackend, setForTesting } = service('powerMonitor');

/** @internal */
export const setPowerMonitorBackendForTesting = setForTesting;

/**
 * Emits `suspend`, `resume`, `lock-screen`, `unlock-screen`, `on-ac` and `on-battery`.
 * Linux listens only with `BUNMASKA_ENABLE_LINUX_POWER=1` and a system bus (D037).
 */
export class PowerMonitorImpl extends EventEmitter {
  getSystemIdleTime(): number {
    return getBackend().getSystemIdleTime();
  }

  getSystemIdleState(idleThreshold: number): SystemIdleState {
    const threshold = Number(idleThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      return 'unknown';
    }
    return getBackend().getSystemIdleState(Math.floor(threshold));
  }

  isOnBatteryPower(): boolean {
    return getBackend().isOnBatteryPower();
  }

  get onBatteryPower(): boolean {
    return this.isOnBatteryPower();
  }
}

export const powerMonitor = new PowerMonitorImpl();
export type PowerMonitor = PowerMonitorImpl;

let observing = false;
let locked = false;

/** Called once from bootstrap `onReady` (D034); later calls are no-ops. @internal */
export const startPowerMonitorObserving = (
  observe: (handlers: PowerEventHandlers) => void = (handlers) => getBackend().observe(handlers),
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
      locked = true;
      powerMonitor.emit('lock-screen');
    },
    onUnlockScreen: () => {
      locked = false;
      powerMonitor.emit('unlock-screen');
    },
    onAc: () => {
      powerMonitor.emit('on-ac');
    },
    onBattery: () => {
      powerMonitor.emit('on-battery');
    },
  });
};

/** Screen-lock latch the API last saw. Backends may also report lock themselves. @internal */
export const isScreenLockedForTesting = (): boolean => locked;

/** @internal */
export const resetPowerMonitorObservingForTesting = (): void => {
  observing = false;
  locked = false;
};
