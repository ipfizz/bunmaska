import { describe, expect, test } from 'bun:test';
import { runApp } from '../../../src/cli/run';

describe('runApp', () => {
  test('passes trailing args through to the entry after the entry path', async () => {
    let captured: readonly string[] = [];
    const spawn = (cmd: readonly string[]) => {
      captured = cmd;
      return { exited: Promise.resolve(0), kill: () => undefined };
    };

    await runApp('app.ts', ['--flag', 'value'], { spawn });

    expect(captured).toEqual(['bun', 'run', 'app.ts', '--flag', 'value']);
  });

  test('carries the engine pin into the child environment', async () => {
    // Without this the app resolves to the system WebKit, which on Windows means
    // no engine at all.
    let env: Record<string, string | undefined> | undefined;
    const spawn = (
      _cmd: readonly string[],
      options: { env?: Record<string, string | undefined> },
    ) => {
      env = options.env;
      return { exited: Promise.resolve(0), kill: () => undefined };
    };

    await runApp('app.ts', [], {
      spawn,
      extraEnv: { BUNMASKA_WEBKIT_ID: 'webkit-2-1.2.3-x-linux-x64' },
    });

    expect(env?.['BUNMASKA_WEBKIT_ID']).toBe('webkit-2-1.2.3-x-linux-x64');
    expect(env?.['PATH']).toBeDefined(); // the ambient environment survives
  });

  test('leaves the environment untouched when there is no pin', async () => {
    let options: { env?: unknown } | undefined;
    const spawn = (_cmd: readonly string[], o: { env?: unknown }) => {
      options = o;
      return { exited: Promise.resolve(0), kill: () => undefined };
    };

    await runApp('app.ts', [], { spawn });

    expect(options?.env).toBeUndefined();
  });

  test('propagates a non-zero child exit code', async () => {
    const spawn = () => ({ exited: Promise.resolve(7), kill: () => undefined });
    const code = await runApp('app.ts', [], { spawn });
    expect(code).toBe(7);
  });

  test('forwards SIGINT and SIGTERM to the app while it runs, then stops listening', async () => {
    const baseline = process.listenerCount('SIGTERM');
    const killed: string[] = [];
    let exit: (code: number) => void = () => undefined;
    const spawn = () => ({
      exited: new Promise<number>((resolve) => {
        exit = resolve;
      }),
      kill: (signal: NodeJS.Signals) => {
        killed.push(signal);
      },
    });

    const running = runApp('app.ts', [], { spawn });
    process.emit('SIGTERM');
    process.emit('SIGINT');
    exit(143);

    expect(await running).toBe(143);
    expect(killed).toEqual(['SIGTERM', 'SIGINT']);
    expect(process.listenerCount('SIGTERM')).toBe(baseline);
  });
});
