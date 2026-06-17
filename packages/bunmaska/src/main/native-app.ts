import { createNativeApplication } from './platform/index';
import type { NativeApplication } from './platform/native';

/**
 * Process-wide lazy singleton for the native application backend.
 *
 * There is exactly one native application per process; `app`, `BrowserWindow`,
 * and friends all resolve their backend through here so they share one run-loop
 * pump and one window registry.
 */

let instance: NativeApplication | undefined;

/** Return the shared native application, creating it on first use. */
export const nativeApp = (): NativeApplication => {
  if (instance === undefined) {
    instance = createNativeApplication();
  }
  return instance;
};

/** Replace the singleton with a fake. Test-only. */
export const setNativeAppForTesting = (fake: NativeApplication | undefined): void => {
  instance = fake;
};
