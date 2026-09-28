/** App side of `bunmaska dev`: reload commands arrive on stdin, one per line. */

/** The command the supervisor writes for a renderer-only change. */
export const DEV_RELOAD_COMMAND = 'reload';

/** True in a dev respawn: windows show without taking focus from the editor. */
export const isDevRestart = (): boolean => process.env['BUNMASKA_DEV_RESTART'] === '1';

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

/** Subscribe to reload commands on `stdin`; the unref'd handle never keeps the app alive. */
export const startDevReload = (reloadAll: () => void, stdin: DevStdin = process.stdin): void => {
  stdin.on('data', (chunk) => {
    handleDevChunk(chunk.toString(), reloadAll);
  });
  stdin.unref?.();
};
