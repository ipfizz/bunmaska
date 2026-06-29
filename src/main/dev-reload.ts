/**
 * Dev live-reload (app side). Under `bunmaska dev` the supervisor sets
 * `BUNMASKA_DEV=1` and, for a renderer-only change, writes a `reload` command on
 * the child's stdin instead of restarting it. This module reads those commands
 * and reloads the open windows in place — so editing the page, styles or preload
 * refreshes the window without it being torn down and reopened.
 */

/** The dev command the supervisor writes for a renderer-only change. */
export const DEV_RELOAD_COMMAND = 'reload';

/** Split a stdin chunk into the trimmed, non-empty commands it carries. Pure. */
export const parseDevCommands = (chunk: string): string[] =>
  chunk
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/** Run `reloadAll` for each `reload` command found in `chunk`. Pure. */
export const handleDevChunk = (chunk: string, reloadAll: () => void): void => {
  for (const command of parseDevCommands(chunk)) {
    if (command === DEV_RELOAD_COMMAND) {
      reloadAll();
    }
  }
};

/** The slice of `process.stdin` this module needs (injectable for tests). */
export type DevStdin = {
  on: (event: 'data', listener: (chunk: Buffer | string) => void) => void;
  unref?: () => void;
};

/**
 * Subscribe to reload commands on `stdin` and run `reloadAll` for each. Does not
 * keep the process alive on its own (the stdin handle is unref'd). Call this once,
 * only in dev — {@link ../main/api/browser-window} gates it on `BUNMASKA_DEV`.
 */
export const startDevReload = (reloadAll: () => void, stdin: DevStdin = process.stdin): void => {
  stdin.on('data', (chunk) => {
    handleDevChunk(chunk.toString(), reloadAll);
  });
  stdin.unref?.();
};
