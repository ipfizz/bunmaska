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

  test('propagates a non-zero child exit code', async () => {
    const spawn = () => ({ exited: Promise.resolve(7) });
    const code = await runApp('app.ts', [], { spawn });
    expect(code).toBe(7);
  });
});
