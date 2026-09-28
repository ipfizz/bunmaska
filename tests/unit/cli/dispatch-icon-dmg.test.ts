import { describe, expect, test } from 'bun:test';
import type { BuildDmg, BuildMacAppOptions, ConvertIcon } from '../../../src/cli/build-macos';
import { dispatch } from '../../../src/cli/index';
import { currentPlatform } from '../../../src/common/platform';

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

  test('--dmg with --target linux is a clear macOS-only error (no build run)', async () => {
    let built = false;
    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'linux', dmg: true } },
      {
        buildLinux: async () => {
          built = true;
          return { appDir: '', tarball: '', deb: '' };
        },
      },
    );

    expect(code).toBe(1);
    expect(built).toBe(false);
  });
});
