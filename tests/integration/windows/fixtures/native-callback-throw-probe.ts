/** Probe: WndProc handlers whose JS throws; its own process, as the rethrows are uncaught by design. */
import { loadUser32 } from '../../../../src/main/platform/windows/win32-ffi';
import { createMessageWindow } from '../../../../src/main/platform/windows/windows-message-window';
import { NativeWin32Window } from '../../../../src/main/platform/windows/windows-native-window';

const WM_USER = 0x0400;
const WM_COMMAND = 0x0111;

const uncaught: string[] = [];
process.on('uncaughtException', (error) => {
  uncaught.push(error.message);
});

const user32 = loadUser32().symbols;
const messages = createMessageWindow((message) => {
  if (message === WM_USER) {
    throw new Error('message window');
  }
});
const frame = new NativeWin32Window({ title: 'throw-probe', width: 100, height: 100, show: false });
frame.onMenuCommand(() => {
  throw new Error('frame proc');
});
user32.SendMessageW(messages.hwnd, WM_USER, 0n, 0n);
user32.SendMessageW(frame.hwnd(), WM_COMMAND, 1n, 0n);

setTimeout(() => {
  messages.destroy();
  frame.destroy();
  process.stdout.write(`${JSON.stringify({ uncaught })}\n`);
}, 0);
