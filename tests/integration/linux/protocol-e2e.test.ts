import { describe, expect, test } from 'bun:test';
import { protocol } from '../../../src/main/api/protocol';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { createLinuxApplication } from '../../../src/main/platform/linux/linux-backend';
import type { NativeApplication, NativeWebContents } from '../../../src/main/platform/native';

/**
 * End-to-end proof that a custom `app://` scheme serves content on real
 * WebKitGTK (the Linux mirror of the macOS protocol round-trip).
 *
 * `protocol.handle('app', ...)` is registered BEFORE the window is created; the
 * URI scheme is wired onto the view's WebKitWebContext at view creation. The
 * view loads `app://host/index.html`; the URI-scheme callback reads the URI,
 * dispatches it through the protocol registry, and serves the bytes via
 * GBytes → GMemoryInputStream → webkit_uri_scheme_request_finish. We pump until
 * did-finish-load, then read the served DOM back with `executeJavaScript`.
 *
 * Runs only in CI ubuntu under `xvfb-run -a` with software GL. Inert on macOS
 * via `describe.skipIf`.
 */

const isLinux = process.platform === 'linux';

const pump = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pumpUntil = async (predicate: () => boolean, budgetMs: number): Promise<void> => {
  const step = 20;
  for (let waited = 0; waited < budgetMs && !predicate(); waited += step) {
    await pump(step);
  }
};

const SERVED_HTML = '<html><body><h1 id=x>HELLO</h1></body></html>';

describe.skipIf(!isLinux)('custom app:// scheme over real WebKitGTK', () => {
  test('loads app://host/index.html and reads the served DOM back', async () => {
    if (loadGtkFFI().symbols.gtk_init_check() === 0) {
      return;
    }

    protocol.handle('app', (request) => {
      if (request.url === 'app://host/index.html') {
        return { data: SERVED_HTML, mimeType: 'text/html' };
      }
      return undefined;
    });

    const app: NativeApplication = createLinuxApplication();
    app.start();
    const window = app.createWindow({
      width: 400,
      height: 300,
      title: 'linux-protocol',
      show: true,
    });
    const contents: NativeWebContents = window.webContents;

    let didFinish = false;
    contents.onDidFinishLoad(() => {
      didFinish = true;
    });
    contents.loadURL('app://host/index.html');

    await pumpUntil(() => didFinish, 20000);
    expect(didFinish).toBe(true);

    const promise = contents.executeJavaScript("document.getElementById('x').textContent");
    let done = false;
    void promise.finally(() => {
      done = true;
    });
    await pumpUntil(() => done, 10000);
    expect(await promise).toBe('HELLO');

    window.close();
    await pump(100);
    app.quit();
    protocol.unhandle('app');
  });
});
