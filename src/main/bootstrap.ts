import { makeCancelableEvent } from '../common/cancelable-event';
import { app } from './api/app';
import { nativeTheme } from './api/native-theme';
import { powerMonitor } from './api/power-monitor';
import { nativeApp } from './native-app';

// Wires `app` to the native backend; separate from `app` and `BrowserWindow` to avoid an import cycle.

let started = false;

export const ensureNativeStarted = (): void => {
  if (started) {
    return;
  }
  started = true;
  const native = nativeApp();
  native.onReady(() => {
    app.markReady();
    // Observers attach native hooks, which need NSApp / GTK initialised first.
    nativeTheme.startObserving();
    powerMonitor.startObserving();
  });
  native.onActivate?.((hasVisibleWindows) => {
    app.emit('activate', makeCancelableEvent(), hasVisibleWindows);
  });
  native.onOpenUrl?.((url) => {
    app.emit('open-url', makeCancelableEvent(), url);
  });
  native.onOpenFile?.((path) => {
    app.emit('open-file', makeCancelableEvent(), path);
  });
  try {
    native.start();
  } catch (error) {
    started = false;
    throw error;
  }
};

/** @internal */
export const resetBootstrapForTesting = (): void => {
  started = false;
};

app.setStartHook(ensureNativeStarted);
// Electron starts on its own, so a bare `app.on('ready', ...)` must not let the process
// exit; the timer keeps code later in this tick ahead of the start, as in Electron.
app.on('newListener', (event: string | symbol) => {
  if (event === 'ready' && !started) {
    setTimeout(ensureNativeStarted, 0);
  }
});
// Stop the pump on `quit`, never `will-quit`: a vetoed quit would kill every later native callback.
app.on('quit', () => nativeApp().quit());
