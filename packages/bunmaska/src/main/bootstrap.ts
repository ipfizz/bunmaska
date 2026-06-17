import { makeCancelableEvent } from '../common/cancelable-event';
import { app } from './api/app';
import { nativeTheme } from './api/native-theme';
import { powerMonitor } from './api/power-monitor';
import { nativeApp } from './native-app';

/**
 * Wires the platform-agnostic {@link app} singleton to the native backend.
 *
 * Imported for its side effects by the public barrel: it registers the native
 * start hook so `app.whenReady()` boots the runtime, and stops the run loop on
 * `will-quit`. Kept separate from both `app` (which must stay native-free for
 * unit tests) and `BrowserWindow` to avoid an import cycle.
 */

let started = false;

/** Start the native app once and mark {@link app} ready when it signals ready. */
export const ensureNativeStarted = (): void => {
  if (started) {
    return;
  }
  started = true;
  const native = nativeApp();
  native.onReady(() => {
    app.markReady();
    // The runtime is up (NSApp / GTK initialised), so the OS observers can safely
    // attach their native notification hooks now.
    nativeTheme.startObserving();
    powerMonitor.startObserving();
  });
  // macOS Dock-reopen → Electron's `activate` (Linux backends omit onActivate).
  native.onActivate?.((hasVisibleWindows) => {
    app.emit('activate', makeCancelableEvent(), hasVisibleWindows);
  });
  // macOS file/URL associations → Electron's `open-url` / `open-file`.
  native.onOpenUrl?.((url) => {
    app.emit('open-url', makeCancelableEvent(), url);
  });
  native.onOpenFile?.((path) => {
    app.emit('open-file', makeCancelableEvent(), path);
  });
  native.start();
};

/** Reset the one-shot guard. Test-only. */
export const resetBootstrapForTesting = (): void => {
  started = false;
};

app.setStartHook(ensureNativeStarted);
app.on('will-quit', () => nativeApp().quit());
