/**
 * For a native callback's catch: rethrow on a clean stack so `uncaughtException` handlers (the
 * app's, else Electron's default error box) see a listener's throw instead of it vanishing.
 */
export const reportCallbackError = (error: unknown): void => {
  queueMicrotask(() => {
    throw error;
  });
};
