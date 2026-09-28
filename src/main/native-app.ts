import { createNativeApplication } from './platform/index';
import type { NativeApplication } from './platform/native';

let instance: NativeApplication | undefined;

/** Exactly one backend per process, so everything shares one run-loop pump and window registry. */
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
