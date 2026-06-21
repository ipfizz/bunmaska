import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { PowerSaveBlockerImpl } from '../../../src/main/api/power-save-blocker';
import { windowsPowerSaveBlockerBackend } from '../../../src/main/platform/windows/windows-power-save-blocker';

/**
 * Windows powerSaveBlocker against the real SetThreadExecutionState API. The OS
 * "stay awake" effect is not observable from a test, so these assert the BACKEND
 * CONTRACT (acquire yields a handle, release never throws, combined blockers are
 * handled) and the public registry bookkeeping over the real backend. The state
 * is always cleared at the end so the test process leaves no lingering block.
 * Runs only on a Windows host; inert elsewhere.
 */
if (currentPlatform() === 'windows') {
  describe('Windows powerSaveBlocker backend', () => {
    test('acquire returns a non-null handle and release does not throw', () => {
      const handle = windowsPowerSaveBlockerBackend.acquire('prevent-display-sleep');
      expect(handle).not.toBeNull();
      expect(() => windowsPowerSaveBlockerBackend.release(handle)).not.toThrow();
    });

    test('combined blockers acquire/release in any order without throwing', () => {
      const a = windowsPowerSaveBlockerBackend.acquire('prevent-app-suspension');
      const b = windowsPowerSaveBlockerBackend.acquire('prevent-display-sleep');
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      windowsPowerSaveBlockerBackend.release(a);
      windowsPowerSaveBlockerBackend.release(b);
      // Releasing an unknown handle is a harmless no-op.
      expect(() => windowsPowerSaveBlockerBackend.release({})).not.toThrow();
    });

    test('the public registry starts/stops over the real backend', () => {
      const blocker = new PowerSaveBlockerImpl(windowsPowerSaveBlockerBackend);
      const id = blocker.start('prevent-app-suspension');
      expect(blocker.isStarted(id)).toBe(true);
      expect(blocker.stop(id)).toBe(true);
      expect(blocker.isStarted(id)).toBe(false);
      // A second stop of the same id is false (already stopped).
      expect(blocker.stop(id)).toBe(false);
    });
  });
}
