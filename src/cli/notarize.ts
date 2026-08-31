/**
 * The default `--notarize` implementation: zip the bundle (notarytool refuses a
 * bare `.app`), submit with `xcrun notarytool --wait`, then staple the ticket.
 */

import { rmSync } from 'node:fs';
import { buildNotarizeArgs, buildStapleArgs, runTool } from './build-macos';

export type NotarizeCredentials = {
  readonly appleId: string;
  readonly teamId: string;
  readonly password: string;
};

/** `ditto -c -k --keepParent` produces the zip layout notarytool expects. */
export const buildDittoArgs = (appPath: string, zipPath: string): string[] => [
  'ditto',
  '-c',
  '-k',
  '--keepParent',
  appPath,
  zipPath,
];

export type ToolRunner = (label: string, argv: string[]) => Promise<void>;

/** Zip, submit (`--wait`), staple; the transient zip is removed even on failure. */
export const notarizeApp = async (
  appPath: string,
  creds: NotarizeCredentials,
  run: ToolRunner = runTool,
): Promise<void> => {
  const zipPath = `${appPath}.zip`;
  try {
    await run('ditto', buildDittoArgs(appPath, zipPath));
    await run(
      'notarytool',
      buildNotarizeArgs({
        appPath: zipPath,
        appleId: creds.appleId,
        teamId: creds.teamId,
        password: creds.password,
      }),
    );
    await run('stapler', buildStapleArgs(appPath));
  } finally {
    rmSync(zipPath, { force: true });
  }
};
