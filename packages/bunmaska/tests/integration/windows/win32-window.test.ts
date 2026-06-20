import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import { Win32Window } from '../../../src/main/platform/windows/win32-window';
import { createWindowsDrain } from '../../../src/main/platform/windows/windows-run-loop';

/**
 * Windows-only. Drives REAL top-level windows through the Win32 backend's window
 * primitive: creation, visibility, title, client size, and the preventable-close
 * routing (a simulated native WM_CLOSE via SendMessageW), plus the cooperative
 * message-pump drain.
 */
const isWindows = currentPlatform() === 'windows';
const WM_CLOSE = 0x0010;

describe.skipIf(!isWindows)('Win32Window on Windows', () => {
  test('creates a real top-level window with a valid HWND', () => {
    const win = new Win32Window({ title: 'Bunmaska Test', width: 640, height: 480, show: false });
    try {
      expect(win.hwnd()).not.toBe(0n);
    } finally {
      win.destroy();
    }
  });

  test('creates a frameless window (the WS_POPUP style path)', () => {
    const win = new Win32Window({
      title: 'Frameless',
      width: 400,
      height: 300,
      show: false,
      frame: false,
    });
    try {
      expect(win.hwnd()).not.toBe(0n);
    } finally {
      win.destroy();
    }
  });

  test('creates a non-resizable window (the thick-frame-stripped style path)', () => {
    const win = new Win32Window({
      title: 'Fixed',
      width: 400,
      height: 300,
      show: false,
      resizable: false,
    });
    try {
      expect(win.hwnd()).not.toBe(0n);
    } finally {
      win.destroy();
    }
  });

  test('reports a positive client size no larger than the requested window size', () => {
    const win = new Win32Window({ title: 'Sized', width: 800, height: 600, show: false });
    try {
      const size = win.getClientSize();
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(size.width).toBeLessThanOrEqual(800);
      expect(size.height).toBeLessThanOrEqual(600);
    } finally {
      win.destroy();
    }
  });

  test('show() makes the window visible and hide() hides it', () => {
    const win = new Win32Window({ title: 'Vis', width: 320, height: 240, show: false });
    try {
      expect(win.isVisible()).toBe(false);
      win.show();
      expect(win.isVisible()).toBe(true);
      win.hide();
      expect(win.isVisible()).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test('setTitle does not throw on a live window', () => {
    const win = new Win32Window({ title: 'Old', width: 320, height: 240, show: false });
    try {
      expect(() => win.setTitle('A New Title')).not.toThrow();
    } finally {
      win.destroy();
    }
  });

  test('a native WM_CLOSE is vetoable, then commits with onClosed firing once', () => {
    const win = new Win32Window({ title: 'Close', width: 320, height: 240, show: false });
    const user32 = loadUser32();
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
    // First WM_CLOSE: vetoed, the window stays open.
    user32.symbols.SendMessageW(win.hwnd(), WM_CLOSE, 0n, 0n);
    expect(closeRequests).toBe(1);
    expect(closed).toBe(0);
    // Second WM_CLOSE: allowed, the window destroys and onClosed fires exactly once.
    veto = false;
    user32.symbols.SendMessageW(win.hwnd(), WM_CLOSE, 0n, 0n);
    expect(closeRequests).toBe(2);
    expect(closed).toBe(1);
  });

  test('destroy() after a native close does not double-fire onClosed', () => {
    const win = new Win32Window({ title: 'Idem', width: 320, height: 240, show: false });
    let closed = 0;
    win.onClosed(() => {
      closed += 1;
    });
    win.onClose(() => false);
    loadUser32().symbols.SendMessageW(win.hwnd(), WM_CLOSE, 0n, 0n);
    win.destroy();
    win.destroy();
    expect(closed).toBe(1);
  });

  test('the cooperative drain pumps queued messages without throwing', () => {
    const drain = createWindowsDrain();
    expect(() => drain()).not.toThrow();
  });
});
