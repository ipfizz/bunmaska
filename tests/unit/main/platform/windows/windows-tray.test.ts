import { describe, expect, test } from 'bun:test';
import {
  isTrayActivation,
  WM_TRAYICON,
} from '../../../../../src/main/platform/windows/windows-tray';

/**
 * Pure tray-callback decoding: the icon's window message carries the icon id in
 * `wParam` and the mouse event in the low word of `lParam`. A left-button release
 * over the matching icon id is the activation; everything else is ignored. No FFI.
 */
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONUP = 0x0205;

describe('isTrayActivation', () => {
  test('a left click on the matching icon id is an activation', () => {
    expect(isTrayActivation(WM_TRAYICON, 1, WM_LBUTTONUP, 1)).toBe(true);
  });

  test('the mouse event is read from the LOW WORD of lParam', () => {
    // High word set (e.g. cursor coords packed in by some shells) must not matter.
    expect(isTrayActivation(WM_TRAYICON, 3, (42 << 16) | WM_LBUTTONUP, 3)).toBe(true);
  });

  test('a different icon id is not this tray', () => {
    expect(isTrayActivation(WM_TRAYICON, 2, WM_LBUTTONUP, 1)).toBe(false);
  });

  test('a right click is not an activation', () => {
    expect(isTrayActivation(WM_TRAYICON, 1, WM_RBUTTONUP, 1)).toBe(false);
  });

  test('an unrelated window message is ignored', () => {
    expect(isTrayActivation(0x0100, 1, WM_LBUTTONUP, 1)).toBe(false);
  });
});
