/**
 * End-to-end proof of the public `webContents.sendInputEvent` API: open a HIDDEN
 * BrowserWindow, synthesize a click through the public API, and read back
 * `event.isTrusted` from the page. Exercises the full delegation chain
 * WebContents → WindowsWebContents → WindowsWebView → postWindowsInputEvent.
 * Run: BUNMASKA_WEBKIT_PATH=<webkit-2311> bun tools/engine/public-input-spike.ts
 */
import { app, BrowserWindow } from '../../src/index';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};
setTimeout(() => finish('PUBLIC_INPUT_FAIL timeout', 1), 20000);

const html = `data:text/html,${encodeURIComponent(
  `<!doctype html><html><body style="margin:0">
   <button id="btn" style="position:absolute;left:280px;top:240px;width:240px;height:120px">CLICK</button>
   <script>
     window.__last = null;
     document.getElementById('btn').addEventListener('click', (e) => {
       window.__last = { isTrusted: e.isTrusted, x: Math.round(e.clientX), y: Math.round(e.clientY) };
     });
   </script></body></html>`,
)}`;

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  const wc = win.webContents;
  wc.once('did-finish-load', async () => {
    const geom = (await wc.executeJavaScript(
      `(() => { const r = document.getElementById('btn').getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    )) as { x: number; y: number };
    wc.sendInputEvent({ type: 'mouseMove', x: geom.x, y: geom.y });
    wc.sendInputEvent({ type: 'mouseDown', x: geom.x, y: geom.y });
    wc.sendInputEvent({ type: 'mouseUp', x: geom.x, y: geom.y });
    await Bun.sleep(300);
    const last = (await wc.executeJavaScript('window.__last')) as {
      isTrusted: boolean;
      x: number;
      y: number;
    } | null;
    if (last?.isTrusted === true) {
      finish(`PUBLIC_INPUT_OK isTrusted=true at (${last.x},${last.y})`, 0);
    }
    finish(`PUBLIC_INPUT_FAIL ${JSON.stringify(last)}`, 2);
  });
  wc.loadURL(html);
});
