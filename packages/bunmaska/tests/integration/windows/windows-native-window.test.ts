import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import {
  dispatchPostedWindowMessage,
  NativeWin32Window,
  pollWindows,
} from '../../../src/main/platform/windows/windows-native-window';
import { createWindowsDrain } from '../../../src/main/platform/windows/windows-run-loop';

const SW_MAXIMIZE = 3;
const SW_RESTORE = 9;
const SWP_NOMOVE_NOZORDER_NOACTIVATE = 0x0002 | 0x0004 | 0x0010;

/**
 * Windows-only. Drives REAL native-WndProc top-level windows (the kind that can
 * host WebKit) and proves the preventable close is routed from the message PUMP
 * (a posted `WM_SYSCOMMAND`/`SC_CLOSE`), not a JSCallback WndProc.
 */
const isWindows = currentPlatform() === 'windows';
const WM_SYSCOMMAND = 0x0112;
const SC_CLOSE = 0xf060;

describe.skipIf(!isWindows)('NativeWin32Window on Windows', () => {
  test('creates a real top-level window with a valid HWND', () => {
    const win = new NativeWin32Window({ title: 'Native', width: 640, height: 480, show: false });
    try {
      expect(win.hwnd()).not.toBe(0n);
    } finally {
      win.destroy();
    }
  });

  test('show()/hide() toggle visibility; setTitle and client size work', () => {
    const win = new NativeWin32Window({ title: 'Vis', width: 320, height: 240, show: false });
    try {
      expect(win.isVisible()).toBe(false);
      win.show();
      expect(win.isVisible()).toBe(true);
      win.hide();
      expect(win.isVisible()).toBe(false);
      expect(() => win.setTitle('Renamed')).not.toThrow();
      const size = win.getClientSize();
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    } finally {
      win.destroy();
    }
  });

  test('creates frameless and non-resizable windows (the style branches)', () => {
    const a = new NativeWin32Window({
      title: 'F',
      width: 400,
      height: 300,
      show: false,
      frame: false,
    });
    const b = new NativeWin32Window({
      title: 'R',
      width: 400,
      height: 300,
      show: false,
      resizable: false,
    });
    try {
      expect(a.hwnd()).not.toBe(0n);
      expect(b.hwnd()).not.toBe(0n);
    } finally {
      a.destroy();
      b.destroy();
    }
  });

  test('a posted title-bar close is vetoable, then commits with onClosed firing once', () => {
    const drain = createWindowsDrain(dispatchPostedWindowMessage);
    const win = new NativeWin32Window({ title: 'Close', width: 320, height: 240, show: false });
    let closeRequests = 0;
    let closed = 0;
    let veto = true;
    win.onClose(() => {
      closeRequests += 1;
      return veto;
    });
    win.onClosed(() => {
      closed += 1;
    });
    const postClose = (): void => {
      loadUser32().symbols.PostMessageW(win.hwnd(), WM_SYSCOMMAND, BigInt(SC_CLOSE), 0n);
    };
    // First close: vetoed, the window stays open.
    postClose();
    drain();
    expect(closeRequests).toBe(1);
    expect(closed).toBe(0);
    // Second close: allowed, the window closes and onClosed fires exactly once.
    veto = false;
    postClose();
    drain();
    expect(closeRequests).toBe(2);
    expect(closed).toBe(1);
  });

  test('programmatic close() honours the veto; destroy() forces it and is idempotent', () => {
    const win = new NativeWin32Window({ title: 'Prog', width: 320, height: 240, show: false });
    let closed = 0;
    win.onClosed(() => {
      closed += 1;
    });
    win.onClose(() => true); // veto everything
    win.close();
    expect(closed).toBe(0); // vetoed, still open
    win.destroy(); // force-close
    win.destroy(); // idempotent
    expect(closed).toBe(1);
  });

  test('pollWindows fires resize once when the client size changes', () => {
    const win = new NativeWin32Window({ title: 'Resize', width: 400, height: 300, show: false });
    let resizes = 0;
    win.onWindowEvent('resize', () => {
      resizes += 1;
    });
    try {
      pollWindows();
      expect(resizes).toBe(0); // no change since construction
      loadUser32().symbols.SetWindowPos(
        win.hwnd(),
        0n,
        0,
        0,
        640,
        520,
        SWP_NOMOVE_NOZORDER_NOACTIVATE,
      );
      pollWindows();
      expect(resizes).toBe(1);
      pollWindows();
      expect(resizes).toBe(1); // stable: no repeat event
    } finally {
      win.destroy();
    }
  });

  test('pollWindows fires maximize then unmaximize', () => {
    const win = new NativeWin32Window({ title: 'Max', width: 400, height: 300, show: false });
    let maximized = 0;
    let unmaximized = 0;
    win.onWindowEvent('maximize', () => {
      maximized += 1;
    });
    win.onWindowEvent('unmaximize', () => {
      unmaximized += 1;
    });
    try {
      loadUser32().symbols.ShowWindow(win.hwnd(), SW_MAXIMIZE);
      pollWindows();
      expect(maximized).toBe(1);
      loadUser32().symbols.ShowWindow(win.hwnd(), SW_RESTORE);
      pollWindows();
      expect(unmaximized).toBe(1);
    } finally {
      win.destroy();
    }
  });

  test('show() and hide() emit show/hide synchronously', () => {
    const win = new NativeWin32Window({ title: 'Vis2', width: 320, height: 240, show: false });
    let shows = 0;
    let hides = 0;
    win.onWindowEvent('show', () => {
      shows += 1;
    });
    win.onWindowEvent('hide', () => {
      hides += 1;
    });
    try {
      win.show();
      win.hide();
      expect(shows).toBe(1);
      expect(hides).toBe(1);
    } finally {
      win.destroy();
    }
  });
});
