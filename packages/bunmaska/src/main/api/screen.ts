import { BunmaskaError, UnsupportedPlatformError } from '../../common/errors';
import { currentPlatform } from '../../common/platform';
import { gdkScreenBackend } from '../platform/linux/gdk-screen';
import { cocoaScreenBackend } from '../platform/macos/cocoa-screen';
import type { Rect } from '../platform/native';
import { windowsScreenBackend } from '../platform/windows/windows-screen';

/**
 * Display enumeration and geometry — the drop-in equivalent of Electron's
 * `screen` module.
 *
 * The public surface is pure TS that consumes a {@link ScreenBackend} (the raw
 * per-platform display data + cursor point). All derived logic —
 * `getPrimaryDisplay`, `getDisplayNearestPoint`, `getDisplayMatching` — lives
 * here and is unit-testable with a fake backend on any host (D024), so the
 * geometry math is exercised without a real display.
 *
 * Coordinate origin: Electron uses top-left screen coordinates. Both backends
 * report top-left-origin rects (CoreGraphics global display space is already
 * top-left; GdkMonitor geometry is top-left), so no flip is applied here.
 */

/** A point in top-left screen coordinates. */
export type Point = {
  readonly x: number;
  readonly y: number;
};

/** A display's pixel dimensions. */
export type Size = {
  readonly width: number;
  readonly height: number;
};

/**
 * A connected display — mirrors the fields of Electron's `Display`.
 *
 * `bounds`/`workArea` are in top-left screen coordinates. `workArea` excludes
 * OS chrome (menu bar / dock) where the platform reports it; on Linux v1 it
 * equals `bounds` (GTK4 GdkMonitor has no work-area API). `scaleFactor` is the
 * device-pixel ratio (>= 1). `rotation` is degrees clockwise (0/90/180/270).
 * `internal` is true for a built-in panel (e.g. a laptop screen).
 */
export type Display = {
  readonly id: number;
  readonly bounds: Rect;
  readonly workArea: Rect;
  readonly size: Size;
  readonly workAreaSize: Size;
  readonly scaleFactor: number;
  readonly rotation: number;
  readonly internal: boolean;
};

/**
 * Raw display data straight from a platform backend, before the public
 * {@link Display} shape (with its derived `size`/`workAreaSize`) is built.
 * `primary` flags the OS's main display; the API resolves the public primary
 * from it.
 */
export type RawDisplay = {
  readonly id: number;
  readonly bounds: Rect;
  readonly workArea: Rect;
  readonly scaleFactor: number;
  readonly rotation: number;
  readonly internal: boolean;
  readonly primary: boolean;
};

/**
 * The native backend the public `screen` API delegates to. Injectable so the
 * pure dispatch/geometry logic is unit-testable without a real display.
 */
export type ScreenBackend = {
  /** Every connected display, raw. Must return at least one on a real host. */
  getDisplays(): readonly RawDisplay[];
  /** The cursor position in top-left screen coordinates (best-effort). */
  getCursorScreenPoint(): Point;
};

const toDisplay = (raw: RawDisplay): Display => ({
  id: raw.id,
  bounds: raw.bounds,
  workArea: raw.workArea,
  size: { width: raw.bounds.width, height: raw.bounds.height },
  workAreaSize: { width: raw.workArea.width, height: raw.workArea.height },
  scaleFactor: raw.scaleFactor,
  rotation: raw.rotation,
  internal: raw.internal,
});

let backend: ScreenBackend | undefined;

const getBackend = (): ScreenBackend => {
  if (backend !== undefined) {
    return backend;
  }
  if (currentPlatform() === 'macos') {
    return cocoaScreenBackend;
  }
  if (currentPlatform() === 'linux') {
    return gdkScreenBackend;
  }
  if (currentPlatform() === 'windows') {
    return windowsScreenBackend;
  }
  throw new UnsupportedPlatformError(`screen is not supported on ${currentPlatform()} yet`);
};

/** Override the native screen backend. Test-only. */
export const setScreenBackendForTesting = (fake: ScreenBackend | undefined): void => {
  backend = fake;
};

const rawDisplays = (): readonly RawDisplay[] => getBackend().getDisplays();

/** Squared distance from a point to the nearest edge of a rect (0 if inside). */
const distanceSqToRect = (point: Point, rect: Rect): number => {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return dx * dx + dy * dy;
};

/** Area of the intersection of two rects (0 when they do not overlap). */
const overlapArea = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const nearestRaw = (point: Point): RawDisplay => {
  const displays = rawDisplays();
  const first = displays[0];
  if (first === undefined) {
    throw new BunmaskaError('screen: no displays available');
  }
  let best = first;
  let bestDist = distanceSqToRect(point, best.bounds);
  for (const d of displays) {
    const dist = distanceSqToRect(point, d.bounds);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
};

/** Every connected display. */
const getAllDisplays = (): Display[] => rawDisplays().map(toDisplay);

/** The OS's primary display (origin-anchored on macOS, index 0 on Linux). */
const getPrimaryDisplay = (): Display => {
  const displays = rawDisplays();
  const first = displays[0];
  if (first === undefined) {
    throw new BunmaskaError('screen: no displays available');
  }
  const primary = displays.find((d) => d.primary) ?? first;
  return toDisplay(primary);
};

/** The display whose bounds contain `point`, or the geometrically nearest one. */
const getDisplayNearestPoint = (point: Point): Display => toDisplay(nearestRaw(point));

/** The display the cursor is currently on (best-effort; may be {0,0}). */
const getCursorScreenPoint = (): Point => getBackend().getCursorScreenPoint();

/**
 * The display with the largest overlap with `rect`; ties and zero-overlap rects
 * fall back to the display nearest the rect's center.
 */
const getDisplayMatching = (rect: Rect): Display => {
  const displays = rawDisplays();
  if (displays.length === 0) {
    throw new BunmaskaError('screen: no displays available');
  }
  let best: RawDisplay | undefined;
  let bestArea = 0;
  for (const d of displays) {
    const area = overlapArea(rect, d.bounds);
    if (area > bestArea) {
      best = d;
      bestArea = area;
    }
  }
  if (best !== undefined) {
    return toDisplay(best);
  }
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return toDisplay(nearestRaw(center));
};

/** The `screen` module — Electron-compatible display enumeration/geometry. */
export const screen = {
  getAllDisplays,
  getPrimaryDisplay,
  getDisplayNearestPoint,
  getCursorScreenPoint,
  getDisplayMatching,
};
