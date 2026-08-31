/**
 * Dev live-reload (app side): for a renderer-only change the `bunmaska dev`
 * supervisor writes a `reload` command on the child's stdin instead of restarting
 * it, and this reloads the open windows in place.
 */

/** The dev command the supervisor writes for a renderer-only change. */
export const DEV_RELOAD_COMMAND = 'reload';

/** Split a stdin chunk into the trimmed, non-empty commands it carries. */
export const parseDevCommands = (chunk: string): string[] =>
  chunk
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/** Run `reloadAll` for each `reload` command found in `chunk`. */
export const handleDevChunk = (chunk: string, reloadAll: () => void): void => {
  for (const command of parseDevCommands(chunk)) {
    if (command === DEV_RELOAD_COMMAND) {
      reloadAll();
    }
  }
};

/** The slice of `process.stdin` this module needs. */
export type DevStdin = {
  on: (event: 'data', listener: (chunk: Buffer | string) => void) => void;
  unref?: () => void;
};

/**
 * Subscribe to reload commands on `stdin`. Does not keep the process alive (the
 * stdin handle is unref'd). Call once, only in dev — `browser-window` gates it on
 * `BUNMASKA_DEV`.
 */
export const startDevReload = (reloadAll: () => void, stdin: DevStdin = process.stdin): void => {
  stdin.on('data', (chunk) => {
    handleDevChunk(chunk.toString(), reloadAll);
  });
  stdin.unref?.();
};
