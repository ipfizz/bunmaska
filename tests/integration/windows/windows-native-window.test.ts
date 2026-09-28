import { describe, expect, test } from 'bun:test';
import { ptr } from 'bun:ffi';
import { currentPlatform } from '../../../src/common/platform';
import { wstr } from '../../../src/main/platform/windows/win32';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import {
  NativeWin32Window,
  pollWindows,
} from '../../../src/main/platform/windows/windows-native-window';
import { createWindowsDrain } from '../../../src/main/platform/windows/windows-run-loop';
import {
  monitorRectsForWindow,
  windowsScreenBackend,
} from '../../../src/main/platform/windows/windows-screen';

const SW_MAXIMIZE = 3;
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
const SWP_NOMOVE_NOZORDER_NOACTIVATE = 0x0002 | 0x0004 | 0x0010;
const SWP_NOZORDER_NOACTIVATE = 0x0004 | 0x0010;
const SWP_NOSIZE_NOZORDER_NOACTIVATE = 0x0001 | 0x0004 | 0x0010;

/** Windows-only: real frame windows, with every close path routed through the veto. */
const isWindows = currentPlatform() === 'windows';
const WM_CLOSE = 0x0010;
const GWL_STYLE = -16;
const WS_POPUP = 0x80000000n;
const WS_CAPTION = 0x00c00000n;
const WS_THICKFRAME = 0x00040000n;
const WS_MAXIMIZEBOX = 0x00010000n;
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

  test('show()/hide() toggle visibility and the client size is positive', () => {
    const win = new NativeWin32Window({ title: 'Vis', width: 320, height: 240, show: false });
    try {
      expect(win.isVisible()).toBe(false);
      win.show();
      expect(win.isVisible()).toBe(true);
      win.hide();
      expect(win.isVisible()).toBe(false);
      const size = win.getClientSize();
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    } finally {
      win.destroy();
    }
  });

  test('frame:false is a captionless popup; resizable:false drops the sizing frame', () => {
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
    const style = (win: NativeWin32Window): bigint =>
      loadUser32().symbols.GetWindowLongPtrW(win.hwnd(), GWL_STYLE);
    try {
      expect(style(a) & WS_POPUP).toBe(WS_POPUP);
      expect(style(a) & WS_CAPTION).toBe(0n);
      expect(style(b) & WS_CAPTION).toBe(WS_CAPTION);
      expect(style(b) & (WS_THICKFRAME | WS_MAXIMIZEBOX)).toBe(0n);
    } finally {
      a.destroy();
      b.destroy();
    }
  });

  test('a posted title-bar close is vetoable, then commits with onClosed firing once', () => {
    const drain = createWindowsDrain();
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

  test('a sent WM_CLOSE or SC_CLOSE goes through the veto and never destroys a WebKit host', () => {
    const win = new NativeWin32Window({
      title: 'SentClose',
      width: 320,
      height: 240,
      show: true,
      destroyOnClose: false,
    });
    const user32 = loadUser32().symbols;
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
    try {
      user32.SendMessageW(win.hwnd(), WM_CLOSE, 0n, 0n);
      expect(closeRequests).toBe(1);
      expect(win.isVisible()).toBe(true);
      veto = false;
      user32.SendMessageW(win.hwnd(), WM_SYSCOMMAND, BigInt(SC_CLOSE), 0n);
      expect(closeRequests).toBe(2);
      expect(closed).toBe(1);
      expect(win.isVisible()).toBe(false);
      user32.SendMessageW(win.hwnd(), WM_CLOSE, 0n, 0n);
      expect(closed).toBe(1);
      // Still a live HWND: GetClientRect reads 0x0 once a window is destroyed.
      expect(win.getClientSize().width).toBeGreaterThan(0);
    } finally {
      win.destroy();
    }
  });

  test('a throwing onClosed still hides the window', () => {
    const win = new NativeWin32Window({
      title: 'Throw',
      width: 320,
      height: 240,
      show: true,
      destroyOnClose: false,
    });
    win.onClosed(() => {
      throw new Error('closed listener');
    });
    expect(() => win.close()).toThrow('closed listener');
    expect(win.isVisible()).toBe(false);
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

  test('pollWindows fires move once for a position-only change', () => {
    const win = new NativeWin32Window({ title: 'Move', width: 400, height: 300, show: false });
    let moves = 0;
    let resizes = 0;
    win.onWindowEvent('move', () => {
      moves += 1;
    });
    win.onWindowEvent('resize', () => {
      resizes += 1;
    });
    try {
      pollWindows();
      expect(moves).toBe(0);
      const { x, y } = win.getBounds();
      loadUser32().symbols.SetWindowPos(
        win.hwnd(),
        0n,
        x + 40,
        y + 30,
        0,
        0,
        SWP_NOSIZE_NOZORDER_NOACTIVATE,
      );
      pollWindows();
      expect(moves).toBe(1);
      expect(resizes).toBe(0);
      pollWindows();
      expect(moves).toBe(1);
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

  test('minimize and restore fire without resizing the view to 0x0', () => {
    const win = new NativeWin32Window({ title: 'Min', width: 400, height: 300, show: false });
    let moves = 0;
    win.onWindowEvent('move', () => {
      moves += 1;
    });
    let minimizes = 0;
    let restores = 0;
    let resizes = 0;
    let hookCalls = 0;
    win.onWindowEvent('minimize', () => {
      minimizes += 1;
    });
    win.onWindowEvent('restore', () => {
      restores += 1;
    });
    win.onWindowEvent('resize', () => {
      resizes += 1;
    });
    win.setResizeHook(() => {
      hookCalls += 1;
    });
    try {
      loadUser32().symbols.ShowWindow(win.hwnd(), SW_MINIMIZE);
      pollWindows();
      expect(minimizes).toBe(1);
      loadUser32().symbols.ShowWindow(win.hwnd(), SW_RESTORE);
      pollWindows();
      expect(restores).toBe(1);
      expect(resizes).toBe(0);
      expect(hookCalls).toBe(0);
      expect(moves).toBe(0);
    } finally {
      win.destroy();
    }
  });

  test('setMinimumSize stops the window shrinking below the minimum', () => {
    const win = new NativeWin32Window({ title: 'MinSize', width: 600, height: 500, show: false });
    try {
      win.setMinimumSize(500, 400);
      loadUser32().symbols.SetWindowPos(
        win.hwnd(),
        0n,
        0,
        0,
        200,
        100,
        SWP_NOMOVE_NOZORDER_NOACTIVATE,
      );
      const { width, height } = win.getBounds();
      expect({ width, height }).toEqual({ width: 500, height: 400 });
    } finally {
      win.destroy();
    }
  });

  test('a minimized window is not visible', () => {
    const win = new NativeWin32Window({ title: 'MinVis', width: 320, height: 240, show: true });
    try {
      loadUser32().symbols.ShowWindow(win.hwnd(), SW_MINIMIZE);
      expect(win.isVisible()).toBe(false);
    } finally {
      win.destroy();
    }
  });

  test('getBounds reports the restored rect while minimized, not the -32000 icon slot', () => {
    const win = new NativeWin32Window({ title: 'Bounds', width: 400, height: 300, show: true });
    try {
      loadUser32().symbols.SetWindowPos(win.hwnd(), 0n, 120, 90, 500, 380, SWP_NOZORDER_NOACTIVATE);
      expect(win.getBounds()).toEqual({ x: 120, y: 90, width: 500, height: 380 });
      loadUser32().symbols.ShowWindow(win.hwnd(), SW_MINIMIZE);
      expect(win.getBounds()).toEqual({ x: 120, y: 90, width: 500, height: 380 });
      const rects = monitorRectsForWindow(win.hwnd());
      const displays = windowsScreenBackend.getDisplays();
      expect(displays.map((d) => d.bounds)).toContainEqual(rects.bounds);
      expect(displays.map((d) => d.workArea)).toContainEqual(rects.workArea);
    } finally {
      win.destroy();
    }
  });

  test('attaching a menu bar resizes the view at once, without a resize event', () => {
    const win = new NativeWin32Window({ title: 'Bar', width: 400, height: 300, show: false });
    const user32 = loadUser32().symbols;
    let resizes = 0;
    let hookHeight = 0;
    win.onWindowEvent('resize', () => {
      resizes += 1;
    });
    win.setResizeHook((_width, height) => {
      hookHeight = height;
    });
    try {
      const before = win.getClientSize().height;
      const bar = user32.CreateMenu();
      user32.AppendMenuW(bar, 0, 1n, ptr(wstr('File')));
      win.setMenuBar(bar);
      expect(hookHeight).toBe(win.getClientSize().height);
      expect(hookHeight).toBeLessThan(before);
      pollWindows();
      expect(resizes).toBe(0);
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

  test('pollWindows invokes the resize hook with the new client size', () => {
    const win = new NativeWin32Window({ title: 'Hook', width: 400, height: 300, show: false });
    let hookCalls = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    win.setResizeHook((width, height) => {
      hookCalls += 1;
      lastWidth = width;
      lastHeight = height;
    });
    try {
      loadUser32().symbols.SetWindowPos(
        win.hwnd(),
        0n,
        0,
        0,
        700,
        560,
        SWP_NOMOVE_NOZORDER_NOACTIVATE,
      );
      pollWindows();
      expect(hookCalls).toBe(1);
      expect(lastWidth).toBeGreaterThan(0);
      expect(lastHeight).toBeGreaterThan(0);
    } finally {
      win.destroy();
    }
  });
});
