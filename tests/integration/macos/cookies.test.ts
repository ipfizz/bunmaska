import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { session } from '../../../src/main/api/session';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';

/**
 * `session.cookies` against the real default `WKHTTPCookieStore`. The store
 * PERSISTS across runs, so the cookie name is unique per run and removed at the
 * end. Every native op carries its own 15s deadline (hang-proof by design).
 */
if (currentPlatform() === 'macos') {
  describe('session.cookies on macOS', () => {
    test('set -> get roundtrip -> remove -> gone', async () => {
      const app = createMacOSApplication();
      app.start();
      const name = `bunmaska_it_${Date.now()}`;
      const expirationDate = Math.floor(Date.now() / 1000) + 3600;
      try {
        await session.defaultSession.cookies.set({
          url: 'https://cookies.bunmaska.test/app/page',
          name,
          value: 'roundtrip',
          secure: true,
          expirationDate,
        });

        const found = await session.defaultSession.cookies.get({ name });
        expect(found).toHaveLength(1);
        const cookie = found[0];
        expect(cookie?.value).toBe('roundtrip');
        expect(cookie?.domain).toBe('cookies.bunmaska.test');
        expect(cookie?.path).toBe('/');
        expect(cookie?.secure).toBe(true);
        expect(cookie?.expirationDate).toBeCloseTo(expirationDate, 0);

        // The url filter enforces the secure flag: http must not see it.
        const overHttp = await session.defaultSession.cookies.get({
          url: 'http://cookies.bunmaska.test/',
        });
        expect(overHttp.find((c) => c.name === name)).toBeUndefined();

        await session.defaultSession.cookies.remove('https://cookies.bunmaska.test/', name);
        expect(await session.defaultSession.cookies.get({ name })).toHaveLength(0);
      } finally {
        app.quit();
      }
    });

    test('set with an empty name rejects instead of storing garbage', async () => {
      const app = createMacOSApplication();
      app.start();
      try {
        await expect(
          session.defaultSession.cookies.set({ url: 'https://cookies.bunmaska.test/' }),
        ).rejects.toThrow();
      } finally {
        app.quit();
      }
    });
  });
}
