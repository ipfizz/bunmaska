import { describe, expect, test } from 'bun:test';
import type { BuildMacAppOptions } from '../../../src/cli/build-macos';
import { dispatch } from '../../../src/cli/index';
import { currentPlatform } from '../../../src/common/platform';

/**
 * Dispatch routing for `--icon <png>` and `--dmg` with the macOS builder
 * stubbed, so no real `bun build --compile`, `sips`, `iconutil`, or `hdiutil`
 * runs. We assert the build receives the icon path and the `dmg` flag, and that
 * the icon-conversion and dmg seams the builder would call are invoked with the
 * right arguments — proving the wiring without shelling out.
 */
describe('dispatch routes --icon and --dmg to the macOS builder', () => {
  const onlyMac = currentPlatform() === 'macos';

  test('threads --icon <png> and --dmg through, invoking the conversion and dmg seams', async () => {
    if (!onlyMac) {
      return;
    }
    let captured: BuildMacAppOptions | undefined;
    let convertedSrc: string | undefined;
    let convertedDest: string | undefined;
    let dmgArgv: string[] | undefined;

    const fakeBuild = async (opts: BuildMacAppOptions): Promise<string> => {
      captured = opts;
      const appPath = `/tmp/${opts.name}.app`;
      // Exercise the seams the real builder calls after layout.
      if (opts.icon !== undefined && opts.convertIcon !== undefined) {
        await opts.convertIcon(opts.icon, `${appPath}/Contents/Resources/${opts.name}.icns`);
      }
      if (opts.dmg === true && opts.buildDmg !== undefined) {
        await opts.buildDmg({ appDir: appPath, name: opts.name, outDmg: `/tmp/${opts.name}.dmg` });
      }
      return appPath;
    };

    const code = await dispatch(
      {
        kind: 'build',
        entry: 'app.ts',
        options: { target: 'macos', name: 'My App', icon: '/tmp/logo.png', dmg: true },
      },
      {
        buildMac: fakeBuild,
        convertIcon: async (src, dest) => {
          convertedSrc = src;
          convertedDest = dest;
        },
        buildDmg: async (opts) => {
          dmgArgv = [opts.appDir, opts.name, opts.outDmg];
        },
      },
    );

    expect(code).toBe(0);
    expect(captured?.icon).toBe('/tmp/logo.png');
    expect(captured?.dmg).toBe(true);
    expect(captured?.convertIcon).toBeDefined();
    expect(captured?.buildDmg).toBeDefined();
    expect(convertedSrc).toBe('/tmp/logo.png');
    expect(convertedDest).toBe('/tmp/My App.app/Contents/Resources/My App.icns');
    expect(dmgArgv).toEqual(['/tmp/My App.app', 'My App', '/tmp/My App.dmg']);
  });

  test('--dmg with --target linux is a clear macOS-only error (no build run)', async () => {
    let built = false;
    const fakeBuild = async (opts: BuildMacAppOptions): Promise<string> => {
      built = true;
      return `/tmp/${opts.name}.app`;
    };

    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'linux', dmg: true } },
      { buildMac: fakeBuild },
    );

    expect(code).toBe(1);
    expect(built).toBe(false);
  });

  test('--dmg without --icon still routes the dmg flag through', async () => {
    if (!onlyMac) {
      return;
    }
    let captured: BuildMacAppOptions | undefined;
    const fakeBuild = async (opts: BuildMacAppOptions): Promise<string> => {
      captured = opts;
      return `/tmp/${opts.name}.app`;
    };

    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'macos', dmg: true, name: 'Plain' } },
      { buildMac: fakeBuild },
    );

    expect(code).toBe(0);
    expect(captured?.dmg).toBe(true);
    expect(captured?.icon).toBeUndefined();
  });
});
