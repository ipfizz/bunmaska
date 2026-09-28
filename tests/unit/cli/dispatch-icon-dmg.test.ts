import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildDmg, BuildMacAppOptions, ConvertIcon } from '../../../src/cli/build-macos';
import { dispatch } from '../../../src/cli/index';
import { currentPlatform } from '../../../src/common/platform';
import { captureStdio } from '../../helpers/capture-stdio';

const onlyMac = currentPlatform() === 'macos';

describe('dispatch routes --icon and --dmg to the macOS builder', () => {
  test.skipIf(!onlyMac)('threads --icon, --dmg and their seams through', async () => {
    let captured: BuildMacAppOptions | undefined;
    const convertIcon: ConvertIcon = async () => undefined;
    const buildDmg: BuildDmg = async () => undefined;

    const code = await dispatch(
      {
        kind: 'build',
        entry: 'app.ts',
        options: { target: 'macos', name: 'My App', icon: '/tmp/logo.png', dmg: true },
      },
      {
        buildMac: async (opts) => {
          captured = opts;
          return `/tmp/${opts.name}.app`;
        },
        convertIcon,
        buildDmg,
      },
    );

    expect(code).toBe(0);
    expect(captured?.icon).toBe('/tmp/logo.png');
    expect(captured?.dmg).toBe(true);
    expect(captured?.convertIcon).toBe(convertIcon);
    expect(captured?.buildDmg).toBe(buildDmg);
  });
});

describe('dispatch keeps each target to the icon type it can use', () => {
  const originalCwd = process.cwd();
  let dir: string | undefined;
  afterEach(() => {
    process.chdir(originalCwd);
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  const buildWith = async (
    target: 'linux' | 'windows',
    icons: { readonly cli?: string; readonly config?: string },
  ): Promise<{ code: number; icon: string | undefined; built: boolean; stderr: string }> => {
    dir = mkdtempSync(join(tmpdir(), 'bunmaska-icon-'));
    if (icons.config !== undefined) {
      writeFileSync(
        join(dir, 'bunmaska.config.ts'),
        `export default { icon: ${JSON.stringify(icons.config)} };\n`,
      );
    }
    process.chdir(dir);
    let icon: string | undefined;
    let built = false;
    let code = -1;
    const streams = await captureStdio(async () => {
      code = await dispatch(
        {
          kind: 'build',
          entry: 'app.ts',
          options: {
            target,
            name: 'Demo',
            ...(icons.cli === undefined ? {} : { icon: icons.cli }),
          },
        },
        {
          buildLinux: async (opts) => {
            built = true;
            icon = opts.icon;
            return { appDir: '', tarball: '', deb: '' };
          },
          buildWindows: async (opts) => {
            built = true;
            icon = opts.icon;
            return { appDir: '', exePath: '', zip: '' };
          },
        },
      );
    });
    return { code, icon, built, stderr: streams.err.join('') };
  };

  test('a config icon the target cannot use is skipped with a warning', async () => {
    const result = await buildWith('windows', { config: 'icon.png' });
    expect(result.code).toBe(0);
    expect(result.icon).toBeUndefined();
    expect(result.stderr).toContain('icon.png');
  });

  test('an --icon the target cannot use fails before building', async () => {
    const result = await buildWith('linux', { cli: 'icon.icns' });
    expect(result.code).toBe(1);
    expect(result.built).toBe(false);
  });

  test('an icon of the right type passes through', async () => {
    expect((await buildWith('linux', { config: 'icon.png' })).icon).toBe('icon.png');
  });
});
