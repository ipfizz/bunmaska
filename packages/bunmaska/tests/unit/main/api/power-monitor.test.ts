import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'bun:test';
import type { PowerEventHandlers } from '../../../../src/main/platform/macos/cocoa-power';
import { PowerMonitorImpl, powerMonitor } from '../../../../src/main/api/power-monitor';

describe('powerMonitor', () => {
  test('is an EventEmitter (for suspend/resume/lock events)', () => {
    expect(powerMonitor).toBeInstanceOf(EventEmitter);
  });
});

describe('powerMonitor.startObserving', () => {
  test('maps each native handler to its corresponding event', () => {
    const monitor = new PowerMonitorImpl();
    let handlers: PowerEventHandlers | undefined;
    const fired: string[] = [];
    for (const event of ['suspend', 'resume', 'lock-screen', 'unlock-screen']) {
      monitor.on(event, () => fired.push(event));
    }
    monitor.startObserving((h) => {
      handlers = h;
    });
    expect(handlers).toBeDefined();
    handlers?.onSuspend();
    handlers?.onResume();
    handlers?.onLockScreen();
    handlers?.onUnlockScreen();
    expect(fired).toEqual(['suspend', 'resume', 'lock-screen', 'unlock-screen']);
  });

  test('is idempotent — only the first call attaches observers', () => {
    const monitor = new PowerMonitorImpl();
    let attaches = 0;
    monitor.startObserving(() => {
      attaches += 1;
    });
    monitor.startObserving(() => {
      attaches += 1;
    });
    expect(attaches).toBe(1);
  });
});
