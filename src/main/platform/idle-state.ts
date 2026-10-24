import type { SystemIdleState } from './services';

/**
 * Electron's idle-state mapping: lock wins, then idle-vs-active against `threshold`
 * seconds. A negative or non-finite idle time is `unknown`.
 */
export const idleStateFrom = (
  idleSeconds: number,
  threshold: number,
  locked: boolean,
): SystemIdleState => {
  if (locked) {
    return 'locked';
  }
  if (!Number.isFinite(idleSeconds) || idleSeconds < 0 || !Number.isFinite(threshold)) {
    return 'unknown';
  }
  return idleSeconds >= threshold ? 'idle' : 'active';
};
