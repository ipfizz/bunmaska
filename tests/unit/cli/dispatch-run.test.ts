import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '../../../src/cli/index';
import { currentArch, currentPlatform } from '../../../src/common/platform';
import { captureStdio } from '../../helpers/capture-stdio';

const ID = `webkit-2-2.52.4-bunmaska1-${currentPlatform()}-${currentArch()}`;
const originalCwd = process.cwd();
let dir: string | undefined;
afterEach(() => {
  process.chdir(originalCwd);
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const runWithPin = async (
  webkit: string,
): Promise<{ env: Readonly<Record<string, string>> | undefined; stderr: string }> => {
  dir = mkdtempSync(join(tmpdir(), 'bunmaska-dispatch-run-'));
  writeFileSync(
    join(dir, 'bunmaska.config.ts'),
    `export default { engine: { webkit: '${webkit}' } };\n`,
  );
  process.chdir(dir);
  let env: Readonly<Record<string, string>> | undefined;
  const streams = await captureStdio(async () => {
    await dispatch(
      { kind: 'run', entry: 'app.ts', args: [] },
      {
        runApp: async (_entry, _args, deps) => {
          env = deps?.extraEnv;
          return 0;
        },
      },
    );
  });
  return { env, stderr: streams.err.join('') };
};

describe('dispatch run forwards the engine pin', () => {
  test('a full engine id reaches the app as BUNMASKA_WEBKIT_ID', async () => {
    const { env } = await runWithPin(ID);
    expect(env).toEqual({ BUNMASKA_WEBKIT_ID: ID });
  });

  test('a bare version warns and launches on the system WebKit', async () => {
    const { env, stderr } = await runWithPin('2.52.4');
    expect(env).toEqual({});
    expect(stderr).toContain('bunmaska run: engine pin "2.52.4" is not a full engine id');
  });

  test("another machine's engine warns and launches on the system WebKit", async () => {
    const arch = currentArch() === 'x64' ? 'arm64' : 'x64';
    const { env } = await runWithPin(`webkit-2-2.52.4-bunmaska1-${currentPlatform()}-${arch}`);
    expect(env).toEqual({});
  });
});
