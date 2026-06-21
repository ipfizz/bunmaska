import { describe, expect, test } from 'bun:test';
import { menuItemFlags } from '../../../../../src/main/platform/windows/windows-menu';

/**
 * Pure AppendMenuW flag mapping for the Windows menu realizer. A disabled item is
 * `MF_GRAYED`; a checked checkbox/radio is `MF_CHECKED`; both compose. (The HMENU
 * build + command dispatch are integration-tested against the real Win32 menu;
 * the popup itself is modal `TrackPopupMenu`, untested like macOS menu tracking.)
 */
const MF_STRING = 0x0;
const MF_GRAYED = 0x1;
const MF_CHECKED = 0x8;

describe('menuItemFlags', () => {
  test('an enabled, unchecked item is a plain string item', () => {
    expect(menuItemFlags(true, false)).toBe(MF_STRING);
  });

  test('a disabled item is grayed', () => {
    expect(menuItemFlags(false, false)).toBe(MF_GRAYED);
  });

  test('a checked item gets the check mark', () => {
    expect(menuItemFlags(true, true)).toBe(MF_CHECKED);
  });

  test('disabled + checked compose', () => {
    expect(menuItemFlags(false, true)).toBe(MF_GRAYED | MF_CHECKED);
  });
});
