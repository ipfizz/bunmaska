import { describe, expect, test } from 'bun:test';
import {
  isBalloonDismiss,
  notificationInfoFlags,
  WM_NOTIFICATION,
} from '../../../../../src/main/platform/windows/windows-notification';

/**
 * Pure mapping for the Windows notification (tray-balloon) backend: the
 * `dwInfoFlags` for the balloon icon/sound, and decoding the icon callback into a
 * balloon-dismissal (the low word of `lParam` carries the NIN_* code).
 */
const NIIF_INFO = 0x1;
const NIIF_NOSOUND = 0x10;
const NIN_BALLOONHIDE = 0x0403;
const NIN_BALLOONTIMEOUT = 0x0404;
const NIN_BALLOONUSERCLICK = 0x0405;
const WM_LBUTTONUP = 0x0202;

describe('notificationInfoFlags', () => {
  test('a normal notification uses the info icon', () => {
    expect(notificationInfoFlags(false)).toBe(NIIF_INFO);
  });

  test('a silent notification mutes the sound', () => {
    expect(notificationInfoFlags(true)).toBe(NIIF_INFO | NIIF_NOSOUND);
  });
});

describe('isBalloonDismiss', () => {
  test('the balloon dismissal codes count as a dismiss for the matching id', () => {
    for (const code of [NIN_BALLOONHIDE, NIN_BALLOONTIMEOUT, NIN_BALLOONUSERCLICK]) {
      expect(isBalloonDismiss(WM_NOTIFICATION, 1, code, 1)).toBe(true);
    }
  });

  test('the code is read from the low word of lParam', () => {
    expect(isBalloonDismiss(WM_NOTIFICATION, 2, (7 << 16) | NIN_BALLOONTIMEOUT, 2)).toBe(true);
  });

  test('a different id is not this notification', () => {
    expect(isBalloonDismiss(WM_NOTIFICATION, 2, NIN_BALLOONTIMEOUT, 1)).toBe(false);
  });

  test('a non-dismiss code is ignored', () => {
    expect(isBalloonDismiss(WM_NOTIFICATION, 1, WM_LBUTTONUP, 1)).toBe(false);
  });

  test('an unrelated message is ignored', () => {
    expect(isBalloonDismiss(0x0100, 1, NIN_BALLOONTIMEOUT, 1)).toBe(false);
  });
});
