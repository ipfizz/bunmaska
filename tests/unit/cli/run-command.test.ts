import { describe, expect, test } from 'bun:test';
import { runApp } from '../../../src/cli/run';

describe('runApp', () => {
  test('spawns `bun run <entry>` inheriting stdio and returns the child exit code', async () => {
    const calls: { cmd: readonly string[]; stdio: unknown }[] = [];
    const spawn = (cmd: readonly string[], options: { stdio: unknown }) => {
      calls.push({ cmd, stdio: options.stdio });
      return { exited: Promise.resolve(0) };
    };

    const code = await runApp('app.ts', [], { spawn });

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toEqual(['bun', 'run', 'app.ts']);
    expect(calls[0]?.stdio).toEqual(['inherit', 'inherit', 'inherit']);
  });

  test('passes trailing args through to the entry after the entry path', async () => {
    let captured: readonly string[] = [];
    const spawn = (cmd: readonly string[]) => {
      captured = cmd;
      return { exited: Promise.resolve(0) };
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
      return { exited: Promise.resolve(0) };
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
      return { exited: Promise.resolve(0) };
    };

    await runApp('app.ts', [], { spawn });

    expect(options?.env).toBeUndefined();
  });

  test('propagates a non-zero child exit code', async () => {
    const spawn = () => ({ exited: Promise.resolve(7) });
    const code = await runApp('app.ts', [], { spawn });
    expect(code).toBe(7);
  });
});
