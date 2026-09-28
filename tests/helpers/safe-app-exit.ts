import { app } from '../../src/main/api/app';
import { buildAppEnvironment } from '../../src/main/api/app-environment';

// The app's quit paths call `process.exit`, so closing the last window in a test
// would end the whole shared test run; these swap in an exit that only records.

let exits: number[] = [];

/** The exit codes the app singleton "exited" with since the last install. */
export const appExitCodes = (): readonly number[] => exits;

/** Install a non-terminating exit on the app singleton, clearing recorded codes. */
export const installSafeAppExit = (): void => {
  exits = [];
  app.setEnvironmentForTesting(
    buildAppEnvironment({
      platform: 'macos',
      home: '/tmp/bunmaska-home',
      temp: '/tmp',
      execPath: '/opt/homebrew/bin/bun',
      mainScript: '',
      cwd: '/tmp',
      env: {},
      locale: 'en-US',
      readFile: () => undefined,
      exit: (code) => {
        exits.push(code);
      },
      relaunch: () => undefined,
    }),
  );
};

/**
 * Behave like a real macOS app: a `window-all-closed` listener suppresses the
 * default quit, so closing the last window does not stop the native run loop.
 * Returns the disposer; call it in `afterAll`.
 */
export const keepAppAlive = (): (() => void) => {
  const listener = (): void => undefined;
  app.on('window-all-closed', listener);
  return () => {
    app.removeListener('window-all-closed', listener);
  };
};
