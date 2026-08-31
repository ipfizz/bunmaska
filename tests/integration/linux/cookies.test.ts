import { describe, expect, test } from 'bun:test';
import { session } from '../../../src/main/api/session';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';

/**
 * `session.cookies` against the real WebKitGTK default network session. A live
 * app + window boots WebKit's network process; every cookie op has its own 15s
 * deadline and each await pumps the GLib context (hang-proof). Runs only in CI
 * ubuntu under `xvfb-run -a`; inert elsewhere via `describe.skipIf`.
 */

const isLinux = process.platform === 'linux';

const pump = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Pump the cooperative loop until `promise` settles (or the budget elapses), then return it. */
const settleWithPump = async <T>(promise: Promise<T>, budgetMs: number): Promise<T> => {
  let done = false;
  void promise
    .catch(() => undefined)
    .finally(() => {
      done = true;
    });
  const step = 20;
  for (let waited = 0; waited < budgetMs && !done; waited += step) {
    await pump(step);
  }
  return promise;
};

describe.skipIf(!isLinux)('session.cookies over the real WebKitGTK network session', () => {
  test('set -> get roundtrip -> remove -> gone', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }
    const app = createLinuxApplication();
    app.start();
    const window = app.createWindow({ width: 320, height: 240, title: 'cookies', show: true });
    const name = `bunmaska_it_${Date.now()}`;
    const expirationDate = Math.floor(Date.now() / 1000) + 3600;
    try {
      await settleWithPump(
        session.defaultSession.cookies.set({
          url: 'https://cookies.bunmaska.test/app/page',
          name,
          value: 'roundtrip',
          secure: true,
          httpOnly: true,
          expirationDate,
        }),
        20000,
      );

      const found = await settleWithPump(session.defaultSession.cookies.get({ name }), 20000);
      expect(found).toHaveLength(1);
      const cookie = found[0];
      expect(cookie?.value).toBe('roundtrip');
      expect(cookie?.domain).toBe('cookies.bunmaska.test');
      expect(cookie?.secure).toBe(true);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.expirationDate ?? 0).toBeGreaterThan(Date.now() / 1000);

      await settleWithPump(
        session.defaultSession.cookies.remove('https://cookies.bunmaska.test/', name),
        20000,
      );
      expect(
        await settleWithPump(session.defaultSession.cookies.get({ name }), 20000),
      ).toHaveLength(0);
    } finally {
      window.close();
      await pump(100);
      app.quit();
    }
  });
});
