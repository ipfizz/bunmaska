/**
 * Bunmaska "hello, webview" — the smallest real app.
 *
 * Run from the repo root with:  bun examples/hello-webview/main.ts
 *
 * Opens a native window with an embedded system WebKit view and loads a page.
 * The cooperative run-loop pump keeps the process alive, so the window stays
 * open until you quit (Cmd-Q / Ctrl-C).
 */
import { app, BrowserWindow } from '../../src/main';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'Hello Bunmaska',
    show: true,
  });
  win.loadURL('https://example.com');
});
