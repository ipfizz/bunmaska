import { makeCancelableEvent } from '../common/cancelable-event';
import { createLogger } from '../common/logger';
import { currentPlatform } from '../common/platform';
import { app } from './api/app';
import { dialog } from './api/dialog';
import { installDefaultApplicationMenu } from './api/menu';
import { startNativeThemeObserving } from './api/native-theme';
import { startPowerMonitorObserving } from './api/power-monitor';
import { nativeApp } from './native-app';

// Wires `app` to the native backend; separate from `app` and `BrowserWindow` to avoid an import cycle.

let started = false;

const log = createLogger('main');

/** Electron's default: an uncaught exception is reported, never fatal, unless the app handles it. @internal */
export const reportUncaughtException = (error: unknown): void => {
  if (process.listeners('uncaughtException').some((l) => l !== reportUncaughtException)) {
    return;
  }
  log.error('uncaught exception', error);
  dialog.showErrorBox(
    'A JavaScript error occurred in the main process',
    `Uncaught Exception:\n${error instanceof Error ? (error.stack ?? String(error)) : String(error)}`,
  );
};

export const ensureNativeStarted = (): void => {
  if (started) {
    return;
  }
  started = true;
  if (!process.listeners('uncaughtException').includes(reportUncaughtException)) {
    process.on('uncaughtException', reportUncaughtException);
  }
  const native = nativeApp();
  native.onReady(() => {
    // Cmd+C/V/X/A/Z reach the web view only through the app menu's Edit items.
    if (currentPlatform() === 'macos') {
      installDefaultApplicationMenu(app.name);
    }
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
  native.setUserDataPath?.(app.getPath('userData'));
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
