import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { session } from '../../../src/main/api/session';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';

/**
 * `session.clearStorageData` against a real `WKWebsiteDataStore`. Proves the
 * void completion-handler Block (D022b) fires on the pumped run loop: the
 * removal's `^(void)` handler resolves the Promise. The app is started so the
 * cooperative pump is running while we await.
 */
if (currentPlatform() === 'macos') {
  describe('session.clearStorageData on macOS', () => {
    test('resolves when the data store removal completes (void block handler)', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        let resolved = false;
        await session.defaultSession.clearStorageData().then(() => {
          resolved = true;
        });
        expect(resolved).toBe(true);
      } finally {
        app.quit();
      }
    });
  });
}
