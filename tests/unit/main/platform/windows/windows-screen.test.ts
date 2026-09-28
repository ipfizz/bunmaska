import { describe, expect, test } from 'bun:test';
import { centerIn } from '../../../../../src/main/platform/windows/windows-screen';

describe('centerIn', () => {
  test('centres in a work area offset by a left-docked taskbar', () => {
    expect(centerIn({ x: 48, y: 0, width: 1872, height: 1080 }, 800, 600)).toEqual({
      x: 584,
      y: 240,
    });
  });

  test('pins a window larger than the work area to its top-left corner', () => {
    expect(centerIn({ x: 1920, y: 40, width: 1280, height: 680 }, 1600, 900)).toEqual({
      x: 1920,
      y: 40,
    });
  });
});
