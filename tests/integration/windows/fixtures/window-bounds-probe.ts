/**
 * Probe: `setPosition` / `setBounds` actually move + size the native window on
 * Windows, and `getBounds` reads the change back (round-trip through Win32
 * SetWindowPos / GetWindowRect). Prints `BOUNDS_OK <json>` on success. Requires
 * BUNMASKA_WEBKIT_PATH (constructing a window spins up the engine).
 */
import { app, BrowserWindow } from '../../../../src/main';

const finish = (line: string, code: number): never => {
  process.stdout.write(`${line}\n`);
  process.exit(code);
};
setTimeout(() => finish('BOUNDS_FAIL timeout', 1), 25000);

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false });

  win.setBounds({ x: 150, y: 120, width: 520, height: 380 });
  const b1 = win.getBounds();

  win.setPosition(60, 70);
  const b2 = win.getBounds();

  const boundsOk = b1.x === 150 && b1.y === 120 && b1.width === 520 && b1.height === 380;
  // setPosition keeps the size from setBounds and only moves the top-left.
  const positionOk = b2.x === 60 && b2.y === 70 && b2.width === 520 && b2.height === 380;

  finish(
    `BOUNDS_OK setBounds=${JSON.stringify(b1)} boundsOk=${boundsOk} ` +
      `setPosition=${JSON.stringify(b2)} positionOk=${positionOk}`,
    boundsOk && positionOk ? 0 : 1,
  );
});

app.on('window-all-closed', () => app.quit());
