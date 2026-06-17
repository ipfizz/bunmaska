import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { cocoaPowerSaveBlockerBackend } from '../../../src/main/platform/macos/cocoa-power-save-blocker';
import type { PowerSaveBlockerType } from '../../../src/main/api/power-save-blocker';

// Exercises the REAL IOKit power assertion (IOPMAssertionCreateWithName / Release) headless
// — no window, no run loop. A successful create returns kIOReturnSuccess (0) and a non-zero
// IOPMAssertionID; we release it immediately so nothing leaks.
if (currentPlatform() === 'macos') {
  describe('cocoa-power-save-blocker (real IOKit)', () => {
    for (const type of [
      'prevent-display-sleep',
      'prevent-app-suspension',
    ] as PowerSaveBlockerType[]) {
      test(`acquire('${type}') returns a real assertion id and releases cleanly`, () => {
        const handle = cocoaPowerSaveBlockerBackend.acquire(type);
        expect(typeof handle).toBe('number');
        expect(handle as number).toBeGreaterThan(0);
        expect(() => cocoaPowerSaveBlockerBackend.release(handle)).not.toThrow();
      });
    }
  });
}
