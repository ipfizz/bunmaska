import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildLinuxAppOptions } from '../../../src/cli/build-linux';
import { dispatch } from '../../../src/cli/index';
import { currentPlatform } from '../../../src/common/platform';

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

  const buildWithConfig = async (
    entry: string | undefined,
  ): Promise<{ code: number; captured: BuildLinuxAppOptions | undefined }> => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-build-entry-'));
    writeFileSync(
      join(dir, 'bunmaska.config.ts'),
      "export default { name: 'Demo', entry: 'src/main.ts' };\n",
    );
    process.chdir(dir);
    let captured: BuildLinuxAppOptions | undefined;
    const code = await dispatch(
      { kind: 'build', ...(entry === undefined ? {} : { entry }), options: { target: 'linux' } },
      {
        buildLinux: async (opts) => {
          captured = opts;
          return { appDir: '/tmp/Demo', tarball: '/tmp/Demo.tar.gz', deb: '/tmp/demo.deb' };
        },
      },
    );
    return { code, captured };
  };

  test('no entry and no config entry is a loud failure', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-build-entry-'));
    process.chdir(dir);
    const code = await dispatch({ kind: 'build', options: {} });
    expect(code).toBe(1);
  });

  test("the config's entry and name are used when the argument is omitted", async () => {
    const { code, captured } = await buildWithConfig(undefined);
    expect(code).toBe(0);
    expect(captured?.entry).toBe('src/main.ts');
    expect(captured?.name).toBe('Demo');
  });

  test('an explicit entry still wins over the config', async () => {
    const { code, captured } = await buildWithConfig('other.ts');
    expect(code).toBe(0);
    expect(captured?.entry).toBe('other.ts');
  });
});

describe("dispatch hands every builder the app's own version", () => {
  const originalCwd = process.cwd();
  let dir: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  const versionFor = async (target: 'linux' | 'windows' | 'macos'): Promise<unknown> => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-build-version-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '4.5.6' }));
    process.chdir(dir);
    let version: unknown;
    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target, name: 'Demo' } },
      {
        buildLinux: async (opts) => {
          version = opts.version;
          return { appDir: '', tarball: '', deb: '' };
        },
        buildWindows: async (opts) => {
          version = opts.version;
          return { appDir: '', exePath: '', zip: '' };
        },
        buildMac: async (opts) => {
          version = opts.version;
          return '/tmp/Demo.app';
        },
      },
    );
    expect(code).toBe(0);
    return version;
  };

  test.each(['linux', 'windows'] as const)('%s', async (target) => {
    expect(await versionFor(target)).toBe('4.5.6');
  });

  test.skipIf(currentPlatform() !== 'macos')('macos', async () => {
    expect(await versionFor('macos')).toBe('4.5.6');
  });
});
