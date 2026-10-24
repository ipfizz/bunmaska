import { EventEmitter } from 'node:events';
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

export type DisplayMetricsChange = {
  readonly display: Display;
  readonly metrics: readonly string[];
};

const metricChanges = (prev: Display, next: Display): string[] => {
  const metrics: string[] = [];
  if (
    prev.bounds.x !== next.bounds.x ||
    prev.bounds.y !== next.bounds.y ||
    prev.bounds.width !== next.bounds.width ||
    prev.bounds.height !== next.bounds.height
  ) {
    metrics.push('bounds');
  }
  if (
    prev.workArea.x !== next.workArea.x ||
    prev.workArea.y !== next.workArea.y ||
    prev.workArea.width !== next.workArea.width ||
    prev.workArea.height !== next.workArea.height
  ) {
    metrics.push('workArea');
  }
  if (prev.scaleFactor !== next.scaleFactor) {
    metrics.push('scaleFactor');
  }
  if (prev.rotation !== next.rotation) {
    metrics.push('rotation');
  }
  return metrics;
};

/** Diff two display snapshots by `id`. Pure; used by the observer and tests. */
export const diffDisplays = (
  previous: readonly Display[],
  next: readonly Display[],
): {
  readonly added: readonly Display[];
  readonly removed: readonly Display[];
  readonly changed: readonly DisplayMetricsChange[];
} => {
  const prevById = new Map(previous.map((d) => [d.id, d]));
  const nextById = new Map(next.map((d) => [d.id, d]));
  const added: Display[] = [];
  const removed: Display[] = [];
  const changed: DisplayMetricsChange[] = [];
  for (const display of next) {
    const prior = prevById.get(display.id);
    if (prior === undefined) {
      added.push(display);
      continue;
    }
    const metrics = metricChanges(prior, display);
    if (metrics.length > 0) {
      changed.push({ display, metrics });
    }
  }
  for (const display of previous) {
    if (!nextById.has(display.id)) {
      removed.push(display);
    }
  }
  return { added, removed, changed };
};

class ScreenImpl extends EventEmitter {
  getAllDisplays = getAllDisplays;
  getPrimaryDisplay = getPrimaryDisplay;
  getDisplayNearestPoint = getDisplayNearestPoint;
  getCursorScreenPoint = getCursorScreenPoint;
  getDisplayMatching = getDisplayMatching;
}

export const screen = new ScreenImpl();

let observing = false;
let lastDisplays: Display[] = [];

const emitDisplayChanges = (): void => {
  const next = getAllDisplays();
  const { added, removed, changed } = diffDisplays(lastDisplays, next);
  lastDisplays = next;
  const event = {};
  for (const display of added) {
    screen.emit('display-added', event, display);
  }
  for (const display of removed) {
    screen.emit('display-removed', event, display);
  }
  for (const { display, metrics } of changed) {
    screen.emit('display-metrics-changed', event, display, metrics);
  }
};

/** Called once from bootstrap `onReady`. Later calls are no-ops. @internal */
export const startScreenObserving = (
  observe: (onChange: () => void) => void = (onChange) => getBackend().observe?.(onChange),
): void => {
  if (observing) {
    return;
  }
  observing = true;
  lastDisplays = getAllDisplays();
  observe(emitDisplayChanges);
};

/** @internal */
export const resetScreenObservingForTesting = (): void => {
  observing = false;
  lastDisplays = [];
  screen.removeAllListeners();
};
