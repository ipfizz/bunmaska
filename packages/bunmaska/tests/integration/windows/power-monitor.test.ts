import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { powerMonitor } from '../../../src/main/api/power-monitor';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import { createMessageWindow } from '../../../src/main/platform/windows/windows-message-window';
import {
  dispatchPowerMessage,
  WM_POWERBROADCAST,
  WM_WTSSESSION_CHANGE,
} from '../../../src/main/platform/windows/windows-power-monitor';
import { createWindowsDrain } from '../../../src/main/platform/windows/windows-run-loop';

/**
 * Windows powerMonitor against a real hidden notification window. Real suspend /
 * lock events can't be triggered from a test, so delivery is driven by POSTING
 * synthetic WM_POWERBROADCAST / WM_WTSSESSION_CHANGE messages to the window and
 * draining the cooperative pump — proving the JSCallback WndProc receives them and
 * the mapping fires the right handler end-to-end. Runs only on Windows.
 */
const PBT_APMSUSPEND = 0x0004n;
const PBT_APMRESUMEAUTOMATIC = 0x0012n;
const WTS_SESSION_LOCK = 0x7n;
const WTS_SESSION_UNLOCK = 0x8n;

if (currentPlatform() === 'windows') {
  describe('Windows powerMonitor (hidden notification window)', () => {
    test('synthetic power/session messages reach the handlers through a real window', () => {
      const events: string[] = [];
      const handlers = {
        onSuspend: () => events.push('suspend'),
        onResume: () => events.push('resume'),
        onLockScreen: () => events.push('lock'),
        onUnlockScreen: () => events.push('unlock'),
      };
      const win = createMessageWindow((message, wParam) =>
        dispatchPowerMessage(handlers, message, Number(wParam)),
      );
      const drain = createWindowsDrain();
      const user32 = loadUser32().symbols;
      try {
        user32.PostMessageW(win.hwnd, WM_POWERBROADCAST, PBT_APMSUSPEND, 0n);
        user32.PostMessageW(win.hwnd, WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC, 0n);
        user32.PostMessageW(win.hwnd, WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK, 0n);
        user32.PostMessageW(win.hwnd, WM_WTSSESSION_CHANGE, WTS_SESSION_UNLOCK, 0n);
        drain();
        expect(events).toEqual(['suspend', 'resume', 'lock', 'unlock']);
      } finally {
        win.destroy();
      }
    });

    test('powerMonitor.startObserving wires the native observer without throwing', () => {
      expect(() => powerMonitor.startObserving()).not.toThrow();
      // Idempotent — a second call is a no-op (the observer is a process singleton).
      expect(() => powerMonitor.startObserving()).not.toThrow();
    });
  });
}
