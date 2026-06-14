import { app } from '../../src/main/api/app';
import { buildAppEnvironment } from '../../src/main/api/app-environment';

/**
 * Test guard against the app singleton terminating the shared test process.
 *
 * `app.quit()` / `app.exit()` (and the `window-all-closed` default-quit) call
 * the environment's `exit`, which in production is `process.exit`. Any test that
 * closes the last `BrowserWindow` would therefore kill the whole test run.
 * {@link installSafeAppExit} swaps in an environment whose `exit` records the
 * code instead, so suites that open/close real windows stay isolated; assert on
 * {@link appExitCodes} when a test cares that a quit happened.
 */

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
