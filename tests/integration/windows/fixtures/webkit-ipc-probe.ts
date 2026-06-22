/**
 * Subprocess fixture: host a real WinCairo WKView in a native window, inject a
 * document-start script that posts a message, and confirm it arrives back in the
 * main process through the cooperative pump. Prints `IPC_OK <body>` on success.
 *
 * Run in a fresh Bun process (not under bun:test) because WebKit's multi-process
 * IPC + thread affinity are incompatible with the test-runner host — the Linux
 * engine-pinned-load test uses the same spawned-subprocess pattern. Requires
 * BUNMASKA_WEBKIT_PATH to point at a WinCairo engine directory.
 */
import { NativeWin32Window } from '../../../../src/main/platform/windows/windows-native-window';
import { createWindowsDrain } from '../../../../src/main/platform/windows/windows-run-loop';
import { WindowsWebView } from '../../../../src/main/platform/windows/windows-webkit-view';

const win = new NativeWin32Window({
  title: 'Bunmaska IPC Probe',
  width: 800,
  height: 600,
  show: true,
});
let received: string | undefined;
const view = WindowsWebView.create({
  hwnd: win.hwnd(),
  width: 800,
  height: 600,
  userScripts: [
    'window.webkit.messageHandlers.bunmaska.postMessage(JSON.stringify({ ping: "pong" }));',
  ],
  messageHandlers: [
    {
      name: 'bunmaska',
      onMessage: (body) => {
        received = body;
      },
    },
  ],
});
view.loadHTML('<!doctype html><html><body>bunmaska</body></html>', 'about:blank');

const drain = createWindowsDrain();
const deadline = Date.now() + 20000;
while (received === undefined && Date.now() < deadline) {
  drain();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

process.stdout.write(received !== undefined ? `IPC_OK ${received}\n` : 'IPC_TIMEOUT\n');
// Exit immediately on the result; teardown of a live multi-process engine is a
// separate concern (and the OS reclaims the child processes on exit).
process.exit(received !== undefined ? 0 : 1);
