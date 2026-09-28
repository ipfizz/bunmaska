import { expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';

test.skipIf(currentPlatform() !== 'macos')(
  'a throwing IMP or Block never unwinds through native frames and surfaces as uncaught',
  async () => {
    const proc = Bun.spawn(
      [process.execPath, 'run', `${import.meta.dir}/fixtures/native-callback-throw-probe.ts`],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({
      voidCalls: 2,
      boolResult: 1,
      objectResult: '0',
      escaped: [],
      uncaught: ['void 1', 'void 2', 'bool', 'object', 'block'],
    });
  },
  20000,
);
