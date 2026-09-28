import { makeCancelableEvent } from '../common/cancelable-event';
import { app } from './api/app';
import { startNativeThemeObserving } from './api/native-theme';
import { startPowerMonitorObserving } from './api/power-monitor';
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
    startNativeThemeObserving();
    startPowerMonitorObserving();
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
  // Deferred: the JS quit must not run inside AppKit's -terminate: call.
  native.onQuitRequest?.(() => {
    setTimeout(() => app.quit(), 0);
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
// Runs only once every quit veto passed, so a cancelled quit keeps the run loop pumping.
app.setShutdownHook(() => nativeApp().quit());
