import { BunmaskaError } from '../../common/errors';
import { service } from '../platform/index';
import type { Rect } from '../platform/native';
import type { Point, RawDisplay } from '../platform/services';

export type Size = {
  readonly width: number;
  readonly height: number;
};

/**
 * `workArea` excludes the menu bar and Dock on macOS and the taskbar on Windows; Linux reports
 * `bounds`. `scaleFactor` is the device-pixel ratio, `rotation` degrees clockwise.
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

const { get: getBackend, setForTesting } = service('screen');

/** @internal */
export const setScreenBackendForTesting = setForTesting;

const rawDisplays = (): readonly RawDisplay[] => getBackend().getDisplays();

/** SQUARED distance to the nearest edge; 0 when the point is inside. */
const distanceSqToRect = (point: Point, rect: Rect): number => {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return dx * dx + dy * dy;
};

/** 0 when the rects do not overlap. */
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

const getAllDisplays = (): Display[] => rawDisplays().map(toDisplay);

/** The display the backend marks primary, else the first. */
const getPrimaryDisplay = (): Display => {
  const displays = rawDisplays();
  const first = displays[0];
  if (first === undefined) {
    throw new BunmaskaError('screen: no displays available');
  }
  const primary = displays.find((d) => d.primary) ?? first;
  return toDisplay(primary);
};

/** Falls back to the geometrically nearest display when no bounds contain `point`. */
const getDisplayNearestPoint = (point: Point): Display => toDisplay(nearestRaw(point));

/** Best-effort; may be `{0, 0}`. */
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

export const screen = {
  getAllDisplays,
  getPrimaryDisplay,
  getDisplayNearestPoint,
  getCursorScreenPoint,
  getDisplayMatching,
};
