import { describe, expect, test } from 'bun:test';
import { dispatch } from '../../../src/cli/index';
import type { BuildMacAppOptions } from '../../../src/cli/build-macos';
import { currentPlatform } from '../../../src/common/platform';

/**
 * Dispatch routing of `--sign`/`--notarize` with the macOS builder stubbed, so
 * no real `bun build --compile` or `codesign` runs. We assert the build was
 * invoked with the right `sign` identity and that the signer seam was called.
 */
describe('dispatch routes --sign to the macOS builder', () => {
  const onlyMac = currentPlatform() === 'macos';

  test('threads --sign - through to buildMacApp and invokes the signer seam', async () => {
    if (!onlyMac) {
      return;
    }
    let captured: BuildMacAppOptions | undefined;
    let signedIdentity: string | undefined;
    let signedPath: string | undefined;

    const fakeBuild = async (opts: BuildMacAppOptions): Promise<string> => {
      captured = opts;
      const appPath = `/tmp/${opts.name}.app`;
      // Exercise the seam the real builder would call after layout.
      if (opts.sign !== undefined && opts.signApp !== undefined) {
        await opts.signApp(opts.sign, appPath);
      }
      return appPath;
    };

    const code = await dispatch(
      {
        kind: 'build',
        entry: 'app.ts',
        options: { target: 'macos', sign: '-', name: 'My App' },
      },
      {
        buildMac: fakeBuild,
        signApp: async (identity, appPath) => {
          signedIdentity = identity;
          signedPath = appPath;
        },
      },
    );

    expect(code).toBe(0);
    expect(captured).toBeDefined();
    expect(captured?.sign).toBe('-');
    expect(captured?.signApp).toBeDefined();
    expect(signedIdentity).toBe('-');
    expect(signedPath).toBe('/tmp/My App.app');
  });

  test('a real identity is passed verbatim to the builder', async () => {
    if (!onlyMac) {
      return;
    }
    let captured: BuildMacAppOptions | undefined;
    const identity = 'Developer ID Application: Jane Doe (TEAMID123)';
    const fakeBuild = async (opts: BuildMacAppOptions): Promise<string> => {
      captured = opts;
      return `/tmp/${opts.name}.app`;
    };

    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'macos', sign: identity } },
      { buildMac: fakeBuild },
    );

    expect(code).toBe(0);
    expect(captured?.sign).toBe(identity);
  });

  test('--sign with --target linux is a clear macOS-only error (no build run)', async () => {
    let built = false;
    const fakeBuild = async (opts: BuildMacAppOptions): Promise<string> => {
      built = true;
      return `/tmp/${opts.name}.app`;
    };

    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'linux', sign: '-' } },
      { buildMac: fakeBuild },
    );

    expect(code).toBe(1);
    expect(built).toBe(false);
  });

  test('--notarize without credentials does not invoke notarytool', async () => {
    if (!onlyMac) {
      return;
    }
    let captured: BuildMacAppOptions | undefined;
    let notarized = false;
    const fakeBuild = async (opts: BuildMacAppOptions): Promise<string> => {
      captured = opts;
      return `/tmp/${opts.name}.app`;
    };

    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'macos', sign: '-', notarize: true } },
      {
        buildMac: fakeBuild,
        notarize: async () => {
          notarized = true;
        },
      },
    );

    expect(code).toBe(0);
    expect(captured?.sign).toBe('-');
    // The notarize hook must NOT run without Apple credentials.
    expect(notarized).toBe(false);
  });
});
