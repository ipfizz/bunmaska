import { describe, expect, test } from 'bun:test';
import {
  dispatchPowerMessage,
  WM_POWERBROADCAST,
  WM_WTSSESSION_CHANGE,
} from '../../../../../src/main/platform/windows/windows-power-monitor';

/**
 * Pure power/session message → handler mapping. `WM_POWERBROADCAST` carries the
 * suspend/resume code in `wParam`; `WM_WTSSESSION_CHANGE` carries the lock/unlock
 * code. Unrelated messages and codes are ignored. No window/FFI needed.
 */
const PBT_APMSUSPEND = 0x0004;
const PBT_APMRESUMESUSPEND = 0x0007;
const PBT_APMRESUMEAUTOMATIC = 0x0012;
const WTS_SESSION_LOCK = 0x7;
const WTS_SESSION_UNLOCK = 0x8;

/** Collect which handlers fired. */
const recorder = (): { events: string[]; handlers: Parameters<typeof dispatchPowerMessage>[0] } => {
  const events: string[] = [];
  return {
    events,
    handlers: {
      onSuspend: () => events.push('suspend'),
      onResume: () => events.push('resume'),
      onLockScreen: () => events.push('lock'),
      onUnlockScreen: () => events.push('unlock'),
    },
  };
};

describe('dispatchPowerMessage', () => {
  test('WM_POWERBROADCAST suspend fires onSuspend', () => {
    const { events, handlers } = recorder();
    dispatchPowerMessage(handlers, WM_POWERBROADCAST, PBT_APMSUSPEND);
    expect(events).toEqual(['suspend']);
  });

  test('both resume codes fire onResume', () => {
    const a = recorder();
    dispatchPowerMessage(a.handlers, WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC);
    expect(a.events).toEqual(['resume']);
    const b = recorder();
    dispatchPowerMessage(b.handlers, WM_POWERBROADCAST, PBT_APMRESUMESUSPEND);
    expect(b.events).toEqual(['resume']);
  });

  test('WM_WTSSESSION_CHANGE lock/unlock fire the screen handlers', () => {
    const { events, handlers } = recorder();
    dispatchPowerMessage(handlers, WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK);
    dispatchPowerMessage(handlers, WM_WTSSESSION_CHANGE, WTS_SESSION_UNLOCK);
    expect(events).toEqual(['lock', 'unlock']);
  });

  test('an unrelated message fires nothing', () => {
    const { events, handlers } = recorder();
    dispatchPowerMessage(handlers, 0x0100, PBT_APMSUSPEND); // WM_KEYDOWN
    expect(events).toEqual([]);
  });

  test('an unknown power/session code fires nothing', () => {
    const { events, handlers } = recorder();
    dispatchPowerMessage(handlers, WM_POWERBROADCAST, 0x99);
    dispatchPowerMessage(handlers, WM_WTSSESSION_CHANGE, 0x1); // WTS_CONSOLE_CONNECT
    expect(events).toEqual([]);
  });
});
