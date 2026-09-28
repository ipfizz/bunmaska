import { expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';

test.skipIf(currentPlatform() !== 'windows')(
  'a throwing WndProc handler never unwinds into native code and surfaces as uncaught',
  async () => {
    const proc = Bun.spawn(
      [process.execPath, 'run', `${import.meta.dir}/fixtures/native-callback-throw-probe.ts`],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({
      uncaught: ['message window', 'frame proc'],
    });
  },
  20000,
);
