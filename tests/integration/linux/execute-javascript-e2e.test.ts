import { describe, expect, test } from 'bun:test';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeApplication, NativeWebContents } from '../../../src/main/platform/native';

/**
 * `WebContents.executeJavaScript` round-trip on a real WebKitGTK web view.
 *
 * The completion value returns out-of-band through a PAGE-world `sambarExec`
 * script-message handler (a per-call `GAsyncReadyCallback` closed mid-invocation
 * frees its trampoline → SIGSEGV; mirrors the macOS D022 page-world channel).
 * Proves an expression, a Promise, an object, and a throw all settle the
 * returned Promise correctly. The page is loaded (and the cooperative pump
 * driven) before the assertions so the page-world handler binding exists.
 *
 * Runs only in CI ubuntu under `xvfb-run -a` with
 * `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `LIBGL_ALWAYS_SOFTWARE=1`,
 * `GDK_BACKEND=x11`. Inert on macOS via `describe.skipIf`.
 */

const isLinux = process.platform === 'linux';

/** Pump the run loop cooperatively for `ms` while yielding to Bun's loop. */
const pump = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Pump until `predicate()` is true or the budget elapses. */
const pumpUntil = async (predicate: () => boolean, budgetMs: number): Promise<void> => {
  const step = 20;
  for (let waited = 0; waited < budgetMs && !predicate(); waited += step) {
    await pump(step);
  }
};

describe.skipIf(!isLinux)('executeJavaScript over a real WebKitGTK webview', () => {
  test('expression, Promise, object round-trip, and throw all settle correctly', async () => {
    // gtk_init_check must succeed under Xvfb; if not, there is no display and
    // the rest cannot run — skip rather than fail.
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }

    const app: NativeApplication = createLinuxApplication();
    app.start();
    const window = app.createWindow({
      width: 400,
      height: 300,
      title: 'linux-exec-js',
      show: true,
    });
    const contents: NativeWebContents = window.webContents;

    let didFinish = false;
    contents.onDidFinishLoad(() => {
      didFinish = true;
    });
    contents.loadHTML('<!doctype html><html><body>exec</body></html>', 'about:blank');

    // Pump until the page (and its page-world `sambarExec` handler) is live.
    await pumpUntil(() => didFinish, 5000);
    expect(didFinish).toBe(true);

    // Settle each exec by pumping the cooperative loop while awaiting it.
    const evalJs = async (code: string): Promise<unknown> => {
      const promise = contents.executeJavaScript(code);
      let done = false;
      void promise.finally(() => {
        done = true;
      });
      await pumpUntil(() => done, 5000);
      return promise;
    };

    expect(await evalJs('1 + 1')).toBe(2);
    expect(await evalJs('Promise.resolve("hi")')).toBe('hi');
    expect(await evalJs('({ a: 1, b: [2, 3], c: "x" })')).toEqual({ a: 1, b: [2, 3], c: 'x' });

    const throwing = contents.executeJavaScript('throw new Error("boom")');
    let threw = false;
    void throwing.catch(() => {
      threw = true;
    });
    await pumpUntil(() => threw, 5000);
    await expect(throwing).rejects.toThrow(/boom/);

    window.close();
    await pump(100);
    app.quit();
  });
});
