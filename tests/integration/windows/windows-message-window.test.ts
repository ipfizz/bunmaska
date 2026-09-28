import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import { createMessageWindow } from '../../../src/main/platform/windows/windows-message-window';

const WM_CLOSE = 0x0010;
const WM_USER = 0x0400;

describe.skipIf(currentPlatform() !== 'windows')('createMessageWindow', () => {
  test('survives WM_CLOSE and keeps delivering messages', () => {
    const seen: number[] = [];
    const win = createMessageWindow((message) => {
      seen.push(message);
    });
    const user32 = loadUser32().symbols;
    try {
      user32.SendMessageW(win.hwnd, WM_CLOSE, 0n, 0n);
      user32.SendMessageW(win.hwnd, WM_USER, 0n, 0n);
      expect(seen).toContain(WM_USER);
    } finally {
      win.destroy();
    }
  });
});
