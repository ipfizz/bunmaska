/**
 * Bunmaska "window controls" — exercising BrowserWindow's runtime setters.
 *
 * Run from the repo root with:  bun examples/window-controls/main.ts
 *
 * Opens a window, then drives resizable / opacity / minimum-size / center and
 * reads them back. Demonstrates the API a settings or tool window needs.
 */
import { app, BrowserWindow } from '../../src/main';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    title: 'Window Controls',
  });

  win.setMinimumSize(420, 320);
  win.setResizable(true);
  win.setOpacity(0.96);
  win.center();
  win.loadURL('https://example.com');

  const [width, height] = win.getSize();
  const [minWidth, minHeight] = win.getMinimumSize();
  process.stdout.write(
    `window: ${width}x${height}, min ${minWidth}x${minHeight}, ` +
      `resizable=${win.isResizable()}, opacity=${win.getOpacity()}\n`,
  );
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
