import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import { WindowsApplication } from '../../../src/main/platform/windows/windows-backend';
import { NativeWin32Window } from '../../../src/main/platform/windows/windows-native-window';

const WM_CLOSE = 0x0010;

describe.skipIf(currentPlatform() !== 'windows')('WindowsApplication', () => {
  test('keeps pumping messages when a ready listener throws', async () => {
    const app = new WindowsApplication();
    app.onReady(() => {
      throw new Error('ready listener');
    });
    expect(() => app.start()).toThrow('ready listener');
    const win = new NativeWin32Window({ title: 'Pump', width: 320, height: 240, show: false });
    let closed = 0;
    win.onClosed(() => {
      closed += 1;
    });
    try {
      loadUser32().symbols.PostMessageW(win.hwnd(), WM_CLOSE, 0n, 0n);
      const deadline = Date.now() + 2000;
      while (closed === 0 && Date.now() < deadline) {
        await Bun.sleep(16);
      }
      expect(closed).toBe(1);
    } finally {
      win.destroy();
      app.quit();
    }
  });
});
