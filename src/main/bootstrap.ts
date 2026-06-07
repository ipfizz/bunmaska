import { makeCancelableEvent } from '../common/cancelable-event';
import { app } from './api/app';
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
  native.onReady(() => app.markReady());
  // macOS Dock-reopen → Electron's `activate` (Linux backends omit onActivate).
  native.onActivate?.((hasVisibleWindows) => {
    app.emit('activate', makeCancelableEvent(), hasVisibleWindows);
  });
  native.start();
};

/** Reset the one-shot guard. Test-only. */
export const resetBootstrapForTesting = (): void => {
  started = false;
};

app.setStartHook(ensureNativeStarted);
app.on('will-quit', () => nativeApp().quit());
