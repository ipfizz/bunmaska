/**
 * `bunmaska run <entry>` — launch a Bunmaska app by spawning `bun run <entry>`
 * with inherited stdio so the app owns the terminal. The spawner is injected
 * so tests can assert the command/args without launching a real GUI process.
 */

/** Minimal shape of a spawned child we depend on: just its exit code. */
export type SpawnedChild = {
  readonly exited: Promise<number>;
};

/** Spawn a command with the given stdio triple. */
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

/**
 * Spawn `bun run <entry> [...args]` and resolve to the child's exit code.
 * The `spawn` dependency defaults to {@link Bun.spawn} with inherited stdio.
 */
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
