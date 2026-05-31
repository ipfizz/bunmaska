import { afterEach, describe, expect, test } from 'bun:test';
import {
  type RawDisplay,
  screen,
  type ScreenBackend,
  setScreenBackendForTesting,
} from '../../../src/main/api/screen';

/**
 * A two-display fake: a primary 1920x1080 at the origin and a secondary
 * 1280x800 placed to its right at x=1920. workArea trims a 25px menu bar off
 * the top of the primary so workArea != bounds is exercised.
 */
const PRIMARY: RawDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 25, width: 1920, height: 1055 },
  scaleFactor: 2,
  rotation: 0,
  internal: true,
  primary: true,
};

const SECONDARY: RawDisplay = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 1280, height: 800 },
  workArea: { x: 1920, y: 0, width: 1280, height: 800 },
  scaleFactor: 1,
  rotation: 90,
  internal: false,
  primary: false,
};

const fakeBackend = (displays: readonly RawDisplay[], cursor = { x: 0, y: 0 }): ScreenBackend => ({
  getDisplays: () => displays,
  getCursorScreenPoint: () => cursor,
});

afterEach(() => {
  setScreenBackendForTesting(undefined);
});

describe('screen.getAllDisplays', () => {
  test('maps every raw display into a full Display shape', () => {
    setScreenBackendForTesting(fakeBackend([PRIMARY, SECONDARY]));
    const all = screen.getAllDisplays();
    expect(all).toHaveLength(2);

    const first = all[0];
    if (first === undefined) {
      throw new Error('expected a display');
    }
    expect(first.id).toBe(1);
    expect(first.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(first.workArea).toEqual({ x: 0, y: 25, width: 1920, height: 1055 });
    expect(first.size).toEqual({ width: 1920, height: 1080 });
    expect(first.workAreaSize).toEqual({ width: 1920, height: 1055 });
    expect(first.scaleFactor).toBe(2);
    expect(first.rotation).toBe(0);
    expect(first.internal).toBe(true);
  });

  test('derives size/workAreaSize from the respective rects', () => {
    setScreenBackendForTesting(fakeBackend([SECONDARY]));
    const d = screen.getAllDisplays()[0];
    if (d === undefined) {
      throw new Error('expected a display');
    }
    expect(d.size).toEqual({ width: 1280, height: 800 });
    expect(d.workAreaSize).toEqual({ width: 1280, height: 800 });
    expect(d.rotation).toBe(90);
    expect(d.internal).toBe(false);
  });
});

describe('screen.getPrimaryDisplay', () => {
  test('returns the display flagged primary even when not first', () => {
    setScreenBackendForTesting(fakeBackend([SECONDARY, PRIMARY]));
    expect(screen.getPrimaryDisplay().id).toBe(1);
  });

  test('falls back to the first display when none is flagged primary', () => {
    const a = { ...SECONDARY, id: 7, primary: false };
    setScreenBackendForTesting(fakeBackend([a]));
    expect(screen.getPrimaryDisplay().id).toBe(7);
  });

  test('throws when there are no displays', () => {
    setScreenBackendForTesting(fakeBackend([]));
    expect(() => screen.getPrimaryDisplay()).toThrow();
  });
});

describe('screen.getDisplayNearestPoint', () => {
  test('returns the display that contains the point', () => {
    setScreenBackendForTesting(fakeBackend([PRIMARY, SECONDARY]));
    expect(screen.getDisplayNearestPoint({ x: 100, y: 100 }).id).toBe(1);
    expect(screen.getDisplayNearestPoint({ x: 2000, y: 400 }).id).toBe(2);
  });

  test('returns the geometrically nearest display for a point outside all bounds', () => {
    setScreenBackendForTesting(fakeBackend([PRIMARY, SECONDARY]));
    // Far to the right of the secondary -> nearest is the secondary.
    expect(screen.getDisplayNearestPoint({ x: 5000, y: 400 }).id).toBe(2);
    // Far left of the primary -> nearest is the primary.
    expect(screen.getDisplayNearestPoint({ x: -500, y: 400 }).id).toBe(1);
  });

  test('treats a point on the shared edge as inside one display', () => {
    setScreenBackendForTesting(fakeBackend([PRIMARY, SECONDARY]));
    const d = screen.getDisplayNearestPoint({ x: 1920, y: 400 });
    expect([1, 2]).toContain(d.id);
  });
});

describe('screen.getDisplayMatching', () => {
  test('returns the display with the largest overlap area', () => {
    setScreenBackendForTesting(fakeBackend([PRIMARY, SECONDARY]));
    // Rect mostly over the secondary.
    const d = screen.getDisplayMatching({ x: 1800, y: 100, width: 600, height: 200 });
    expect(d.id).toBe(2);
  });

  test('falls back to nearest-point on the rect center when nothing overlaps', () => {
    setScreenBackendForTesting(fakeBackend([PRIMARY, SECONDARY]));
    const d = screen.getDisplayMatching({ x: 4000, y: 4000, width: 10, height: 10 });
    expect(d.id).toBe(2);
  });
});

describe('screen.getCursorScreenPoint', () => {
  test('passes the backend cursor point through', () => {
    setScreenBackendForTesting(fakeBackend([PRIMARY], { x: 321, y: 654 }));
    expect(screen.getCursorScreenPoint()).toEqual({ x: 321, y: 654 });
  });
});
