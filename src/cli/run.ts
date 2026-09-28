/**
 * `bunmaska run <entry>`: spawns `bun run <entry>` with inherited stdio so the
 * app owns the terminal.
 */

export type SpawnedChild = {
  readonly exited: Promise<number>;
  readonly kill: (signal: NodeJS.Signals) => void;
};

export type Spawner = (
  command: readonly string[],
  options: { readonly env?: Readonly<Record<string, string | undefined>> },
) => SpawnedChild;

const defaultSpawner: Spawner = (command, options) =>
  Bun.spawn(command as string[], {
    stdio: ['inherit', 'inherit', 'inherit'],
    ...(options.env !== undefined ? { env: options.env } : {}),
  });

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** Resolves to the child's exit code. */
export const runApp = async (
  entry: string,
  args: readonly string[],
  deps: { readonly spawn?: Spawner; readonly extraEnv?: Readonly<Record<string, string>> } = {},
): Promise<number> => {
  const spawn = deps.spawn ?? defaultSpawner;
  const child = spawn(['bun', 'run', entry, ...args], {
    ...(deps.extraEnv !== undefined ? { env: { ...process.env, ...deps.extraEnv } } : {}),
  });
  // Killing the CLI (IDE stop button, process manager) must not orphan the app window.
  const forwards = FORWARDED_SIGNALS.map((signal) => [signal, () => child.kill(signal)] as const);
  for (const [signal, forward] of forwards) {
    process.on(signal, forward);
  }
  try {
    return await child.exited;
  } finally {
    for (const [signal, forward] of forwards) {
      process.off(signal, forward);
    }
  }
};
