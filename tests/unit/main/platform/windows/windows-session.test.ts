import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../../src/common/errors';
import { windowsSessionBackend } from '../../../../../src/main/platform/windows/windows-session';

describe('windowsSessionBackend cookies', () => {
  test('every cookie method rejects with UnsupportedPlatformError naming the WinCairo gap', async () => {
    const rejections = await Promise.all([
      windowsSessionBackend.getCookies({}).catch((error: unknown) => error),
      windowsSessionBackend
        .setCookie({
          name: 'a',
          value: '1',
          domain: 'x',
          path: '/',
          secure: false,
          httpOnly: false,
        })
        .catch((error: unknown) => error),
      windowsSessionBackend.removeCookie('https://x/', 'a').catch((error: unknown) => error),
    ]);
    for (const rejection of rejections) {
      expect(rejection).toBeInstanceOf(UnsupportedPlatformError);
      expect((rejection as Error).message).toContain('WinCairo');
    }
  });
});
