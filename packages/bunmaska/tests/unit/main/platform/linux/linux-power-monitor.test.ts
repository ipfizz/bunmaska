import type { Pointer } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import type { PowerEventHandlers } from '../../../../../src/main/platform/macos/cocoa-power';
import {
  decodePrepareForSleep,
  observePowerEvents,
  type PowerDbusDeps,
} from '../../../../../src/main/platform/linux/linux-power-monitor';
import type { SignalEvent, SignalMatch } from '../../../../../src/main/platform/linux/linux-dbus';

const spyHandlers = (): { fired: string[]; handlers: PowerEventHandlers } => {
  const fired: string[] = [];
  return {
    fired,
    handlers: {
      onSuspend: () => fired.push('suspend'),
      onResume: () => fired.push('resume'),
      onLockScreen: () => fired.push('lock-screen'),
      onUnlockScreen: () => fired.push('unlock-screen'),
    },
  };
};

describe('decodePrepareForSleep', () => {
  test('start=true ⇒ suspend; start=false ⇒ resume', () => {
    const { fired, handlers } = spyHandlers();
    decodePrepareForSleep(true, handlers);
    decodePrepareForSleep(false, handlers);
    expect(fired).toEqual(['suspend', 'resume']);
  });
});

describe('observePowerEvents (fake D-Bus seam, no FFI)', () => {
  /** A fake bus that captures the subscribed callbacks by signal member. */
  const fakeSeam = (
    bus: Pointer | null,
    sleepBoolean: boolean,
  ): {
    deps: PowerDbusDeps;
    captured: Map<string, (e: SignalEvent) => void>;
    subscribes: () => number;
  } => {
    const captured = new Map<string, (e: SignalEvent) => void>();
    let subscribes = 0;
    return {
      captured,
      subscribes: () => subscribes,
      deps: {
        getSystemBus: () => bus,
        subscribeSignal: (_conn: Pointer, match: SignalMatch, cb) => {
          subscribes += 1;
          captured.set(match.member ?? '', cb);
          return subscribes;
        },
        readSleepBoolean: () => sleepBoolean,
      },
    };
  };

  test('PrepareForSleep(true) ⇒ suspend; Lock/Unlock ⇒ lock/unlock', () => {
    const { fired, handlers } = spyHandlers();
    const { deps, captured } = fakeSeam(1 as unknown as Pointer, true);
    observePowerEvents(handlers, deps);
    const ev: SignalEvent = { signalName: 'x', parameters: 0 as unknown as Pointer };
    captured.get('PrepareForSleep')?.(ev);
    captured.get('Lock')?.(ev);
    captured.get('Unlock')?.(ev);
    expect(fired).toEqual(['suspend', 'lock-screen', 'unlock-screen']);
  });

  test('PrepareForSleep(false) ⇒ resume', () => {
    const { fired, handlers } = spyHandlers();
    const { deps, captured } = fakeSeam(1 as unknown as Pointer, false);
    observePowerEvents(handlers, deps);
    captured.get('PrepareForSleep')?.({ signalName: 'x', parameters: 0 as unknown as Pointer });
    expect(fired).toEqual(['resume']);
  });

  test('no system bus ⇒ no subscriptions, no throw', () => {
    const { fired, handlers } = spyHandlers();
    const { deps, subscribes } = fakeSeam(null, true);
    expect(() => observePowerEvents(handlers, deps)).not.toThrow();
    expect(subscribes()).toBe(0);
    expect(fired).toEqual([]);
  });
});
