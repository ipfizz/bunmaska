/** The smallest real app. Run from the repo root: bun examples/hello-webview/main.ts */
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
