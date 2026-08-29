/**
 * `bunmaska run <entry>`: spawns `bun run <entry>` with inherited stdio so the
 * app owns the terminal.
 */

export type SpawnedChild = {
  readonly exited: Promise<number>;
};

export type Spawner = (
  command: readonly string[],
  options: {
    readonly stdio: readonly ['inherit', 'inherit', 'inherit'];
    readonly env?: Readonly<Record<string, string | undefined>>;
  },
) => SpawnedChild;

const defaultSpawner: Spawner = (command, options) =>
  Bun.spawn(command as string[], {
    stdin: options.stdio[0],
    stdout: options.stdio[1],
    stderr: options.stdio[2],
    ...(options.env !== undefined ? { env: options.env } : {}),
  });

/** Resolves to the child's exit code. */
export const runApp = async (
  entry: string,
  args: readonly string[],
  deps: { readonly spawn?: Spawner; readonly extraEnv?: Readonly<Record<string, string>> } = {},
): Promise<number> => {
  const spawn = deps.spawn ?? defaultSpawner;
  const child = spawn(['bun', 'run', entry, ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    ...(deps.extraEnv !== undefined ? { env: { ...process.env, ...deps.extraEnv } } : {}),
  });
  return await child.exited;
};
