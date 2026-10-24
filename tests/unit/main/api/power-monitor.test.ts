import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  powerMonitor,
  resetPowerMonitorObservingForTesting,
  setPowerMonitorBackendForTesting,
  startPowerMonitorObserving,
} from '../../../../src/main/api/power-monitor';
import type { PowerEventHandlers, PowerMonitorBackend } from '../../../../src/main/platform/services';

describe('powerMonitor', () => {
  test('is an EventEmitter (for suspend/resume/lock events)', () => {
    expect(powerMonitor).toBeInstanceOf(EventEmitter);
  });
});

describe('startPowerMonitorObserving', () => {
  beforeEach(resetPowerMonitorObservingForTesting);
  afterEach(() => {
    powerMonitor.removeAllListeners();
  });

  test('maps each native handler to its corresponding event', () => {
    let handlers: PowerEventHandlers | undefined;
    const fired: string[] = [];
    for (const event of ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'on-ac', 'on-battery']) {
      powerMonitor.on(event, () => fired.push(event));
    }
    startPowerMonitorObserving((h) => {
      handlers = h;
    });
    expect(handlers).toBeDefined();
    handlers?.onSuspend();
    handlers?.onResume();
    handlers?.onLockScreen();
    handlers?.onUnlockScreen();
    handlers?.onAc?.();
    handlers?.onBattery?.();
    expect(fired).toEqual([
      'suspend',
      'resume',
      'lock-screen',
      'unlock-screen',
      'on-ac',
      'on-battery',
    ]);
  });

  test('is idempotent: only the first call attaches observers', () => {
    let attaches = 0;
    startPowerMonitorObserving(() => {
      attaches += 1;
    });
    startPowerMonitorObserving(() => {
      attaches += 1;
    });
    expect(attaches).toBe(1);
  });
});

describe('powerMonitor idle and battery queries', () => {
  afterEach(() => {
    setPowerMonitorBackendForTesting(undefined);
  });

  const fake = (overrides: Partial<PowerMonitorBackend> = {}): PowerMonitorBackend => ({
    observe: () => undefined,
    getSystemIdleTime: () => 12,
    getSystemIdleState: (threshold) => (threshold <= 12 ? 'idle' : 'active'),
    isOnBatteryPower: () => true,
    ...overrides,
  });

  test('getSystemIdleTime / getSystemIdleState / isOnBatteryPower / onBatteryPower', () => {
    setPowerMonitorBackendForTesting(fake());
    expect(powerMonitor.getSystemIdleTime()).toBe(12);
    expect(powerMonitor.getSystemIdleState(10)).toBe('idle');
    expect(powerMonitor.getSystemIdleState(20)).toBe('active');
    expect(powerMonitor.isOnBatteryPower()).toBe(true);
    expect(powerMonitor.onBatteryPower).toBe(true);
  });

  test('a non-finite idle threshold is unknown', () => {
    setPowerMonitorBackendForTesting(fake());
    expect(powerMonitor.getSystemIdleState(Number.NaN)).toBe('unknown');
    expect(powerMonitor.getSystemIdleState(-1)).toBe('unknown');
  });
});
