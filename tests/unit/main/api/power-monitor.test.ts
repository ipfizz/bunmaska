import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  powerMonitor,
  resetPowerMonitorObservingForTesting,
  startPowerMonitorObserving,
} from '../../../../src/main/api/power-monitor';
import type { PowerEventHandlers } from '../../../../src/main/platform/services';

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
    for (const event of ['suspend', 'resume', 'lock-screen', 'unlock-screen']) {
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
    expect(fired).toEqual(['suspend', 'resume', 'lock-screen', 'unlock-screen']);
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
