/**
 * Dev-only window-state persistence. Under `bunmaska dev` the supervisor sets
 * `BUNMASKA_DEV_STATE` to a scratch JSON path; the first BrowserWindow seeds its
 * bounds from it and writes them back on move/resize, so a restart reopens the
 * window where the developer left it instead of at the OS default. Strictly
 * inert without the env var - a packaged app never touches this path.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Rect } from './platform/native';

/** Debounce for state writes; a drag emits a move per frame. */
export const DEV_STATE_WRITE_DEBOUNCE_MS = 300;

/** Parse a persisted state file's bounds, or `undefined` for anything invalid. */
export const parseDevWindowState = (raw: string): Rect | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const bounds = record['bounds'];
  if (bounds === null || typeof bounds !== 'object') {
    return undefined;
  }
  const rect = bounds as Record<string, unknown>;
  const nums = [rect['x'], rect['y'], rect['width'], rect['height']];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return undefined;
  }
  const [x, y, width, height] = nums as [number, number, number, number];
  if (width < 50 || height < 50) {
    return undefined;
  }
  return { x, y, width, height };
};

export const serializeDevWindowState = (bounds: Rect): string => `${JSON.stringify({ bounds })}\n`;

/** The persisted dev bounds, or `undefined` (no env var, no file, bad contents). */
export const readDevWindowState = (statePath: string | undefined): Rect | undefined => {
  if (statePath === undefined || statePath === '') {
    return undefined;
  }
  try {
    return parseDevWindowState(readFileSync(statePath, 'utf8'));
  } catch {
    return undefined;
  }
};

/**
 * A debounced best-effort writer; every failure is swallowed (losing dev window
 * state must never affect the app).
 */
export const makeDevWindowStateWriter = (
  statePath: string,
  getBounds: () => Rect,
): (() => void) => {
  let pending: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    pending = setTimeout(() => {
      pending = undefined;
      try {
        writeFileSync(statePath, serializeDevWindowState(getBounds()));
      } catch {
        // Best effort only.
      }
    }, DEV_STATE_WRITE_DEBOUNCE_MS);
    pending.unref?.();
  };
};
