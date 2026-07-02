import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildMacAppOptions } from '../../../src/cli/build-macos';
import { dispatch } from '../../../src/cli/index';
import { currentPlatform } from '../../../src/common/platform';

/**
 * `bunmaska build` without an explicit entry resolves it from the project's
 * `bunmaska.config.ts` (the init scaffold declares one), mirroring `bunmaska dev`.
 * With neither an argument nor a config entry it fails loudly.
 */
describe('dispatch resolves the build entry from bunmaska.config.ts', () => {
  const originalCwd = process.cwd();
  let dir: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test('no entry and no config entry is a loud failure', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-build-entry-'));
    process.chdir(dir);
    const code = await dispatch({ kind: 'build', options: {} });
    expect(code).toBe(1);
  });

  test("the config's entry is used when the argument is omitted", async () => {
    if (currentPlatform() !== 'macos') {
      return;
    }
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-build-entry-'));
    writeFileSync(
      join(dir, 'bunmaska.config.ts'),
      "export default { name: 'Demo', entry: 'src/main.ts' };\n",
    );
    process.chdir(dir);

    let captured: BuildMacAppOptions | undefined;
    const code = await dispatch(
      { kind: 'build', options: { target: 'macos' } },
      {
        buildMac: async (opts) => {
          captured = opts;
          return `/tmp/${opts.name}.app`;
        },
      },
    );
    expect(code).toBe(0);
    expect(captured?.entry).toBe('src/main.ts');
    expect(captured?.name).toBe('main');
  });

  test('an explicit entry still wins over the config', async () => {
    if (currentPlatform() !== 'macos') {
      return;
    }
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-build-entry-'));
    writeFileSync(
      join(dir, 'bunmaska.config.ts'),
      "export default { name: 'Demo', entry: 'src/main.ts' };\n",
    );
    process.chdir(dir);

    let captured: BuildMacAppOptions | undefined;
    const code = await dispatch(
      { kind: 'build', entry: 'other.ts', options: { target: 'macos' } },
      {
        buildMac: async (opts) => {
          captured = opts;
          return `/tmp/${opts.name}.app`;
        },
      },
    );
    expect(code).toBe(0);
    expect(captured?.entry).toBe('other.ts');
  });
});
