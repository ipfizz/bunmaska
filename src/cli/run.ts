/**
 * `bunmaska run <entry>`: spawns `bun run <entry>` with inherited stdio so the
 * app owns the terminal.
 */

export type SpawnedChild = {
  readonly exited: Promise<number>;
};

export type Spawner = (
  command: readonly string[],
  options: { readonly stdio: readonly ['inherit', 'inherit', 'inherit'] },
) => SpawnedChild;

const defaultSpawner: Spawner = (command, options) =>
  Bun.spawn(command as string[], {
    stdin: options.stdio[0],
    stdout: options.stdio[1],
    stderr: options.stdio[2],
  });

/** Resolves to the child's exit code. */
export const runApp = async (
  entry: string,
  args: readonly string[],
  deps: { readonly spawn?: Spawner } = {},
): Promise<number> => {
  const spawn = deps.spawn ?? defaultSpawner;
  const child = spawn(['bun', 'run', entry, ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  return await child.exited;
};
