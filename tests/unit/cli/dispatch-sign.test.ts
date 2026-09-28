import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BuildMacAppOptions, SignApp } from '../../../src/cli/build-macos';
import { dispatch } from '../../../src/cli/index';
import { currentPlatform } from '../../../src/common/platform';

const onlyMac = currentPlatform() === 'macos';

const NOTARIZE_ENV = ['APPLE_ID', 'TEAM_ID', 'BUNMASKA_NOTARIZE_PASSWORD'] as const;
const DEVELOPER_ID = 'Developer ID Application: Example (TEAMID123)';

describe('dispatch routes --sign to the macOS builder', () => {
  test.skipIf(!onlyMac)('threads --sign and the signer seam through to buildMacApp', async () => {
    let captured: BuildMacAppOptions | undefined;
    const signApp: SignApp = async () => undefined;

    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'macos', sign: '-', name: 'My App' } },
      {
        buildMac: async (opts) => {
          captured = opts;
          return `/tmp/${opts.name}.app`;
        },
        signApp,
      },
    );

    expect(code).toBe(0);
    expect(captured?.sign).toBe('-');
    expect(captured?.signApp).toBe(signApp);
  });
});

describe('dispatch --notarize', () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const key of NOTARIZE_ENV) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const notarizeBuild = async (): Promise<{ code: number; notarized: string[] }> => {
    const notarized: string[] = [];
    const code = await dispatch(
      {
        kind: 'build',
        entry: 'app.ts',
        options: { target: 'macos', sign: DEVELOPER_ID, notarize: true },
      },
      {
        buildMac: async (opts) => {
          await opts.notarize?.(`/tmp/${opts.name}.app`);
          return `/tmp/${opts.name}.app`;
        },
        notarize: async (appPath) => {
          notarized.push(appPath);
        },
      },
    );
    return { code, notarized };
  };

  test.skipIf(!onlyMac)('refuses --notarize without --sign before building', async () => {
    let built = false;
    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'macos', notarize: true } },
      {
        buildMac: async () => {
          built = true;
          return '/tmp/app.app';
        },
      },
    );
    expect(code).toBe(1);
    expect(built).toBe(false);
  });

  test.skipIf(!onlyMac)('refuses --notarize with an ad-hoc signature before building', async () => {
    let built = false;
    const code = await dispatch(
      { kind: 'build', entry: 'app.ts', options: { target: 'macos', sign: '-', notarize: true } },
      {
        buildMac: async () => {
          built = true;
          return '/tmp/app.app';
        },
      },
    );
    expect(code).toBe(1);
    expect(built).toBe(false);
  });

  test.skipIf(!onlyMac)('skips notarytool without Apple credentials', async () => {
    const { code, notarized } = await notarizeBuild();
    expect(code).toBe(0);
    expect(notarized).toEqual([]);
  });

  test.skipIf(!onlyMac)('notarizes the built .app when the credentials are set', async () => {
    process.env['APPLE_ID'] = 'dev@example.com';
    process.env['TEAM_ID'] = 'TEAMID123';
    process.env['BUNMASKA_NOTARIZE_PASSWORD'] = 'app-specific';
    const { code, notarized } = await notarizeBuild();
    expect(code).toBe(0);
    expect(notarized).toEqual(['/tmp/app.app']);
  });

  test.skipIf(!onlyMac)('with --dmg, lets the builder notarize before it packages', async () => {
    process.env['APPLE_ID'] = 'dev@example.com';
    process.env['TEAM_ID'] = 'TEAMID123';
    process.env['BUNMASKA_NOTARIZE_PASSWORD'] = 'app-specific';
    let captured: BuildMacAppOptions | undefined;
    const notarize = async (): Promise<void> => undefined;
    const code = await dispatch(
      {
        kind: 'build',
        entry: 'app.ts',
        options: { target: 'macos', sign: DEVELOPER_ID, notarize: true, dmg: true },
      },
      {
        buildMac: async (opts) => {
          captured = opts;
          return '/tmp/out/app.app';
        },
        notarize,
      },
    );
    expect(code).toBe(0);
    expect(captured?.dmg).toBe(true);
    expect(captured?.notarize).toBe(notarize);
  });
});
