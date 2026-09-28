import { describe, expect, test } from 'bun:test';
import {
  buildCodesignArgs,
  buildCodesignVerifyArgs,
  buildNotarizeArgs,
  buildStapleArgs,
  codesignEntitlements,
} from '../../../src/cli/build-macos';

describe('buildCodesignArgs', () => {
  const appPath = '/tmp/out/My App.app';
  const entitlements = '/tmp/ent/app.entitlements';

  test('signs a Developer ID bundle with the hardened runtime and a secure timestamp', () => {
    const identity = 'Developer ID Application: Jane Doe (TEAMID123)';
    expect(buildCodesignArgs(identity, appPath, entitlements)).toEqual([
      '--force',
      '--deep',
      '--options',
      'runtime',
      '--timestamp',
      '--entitlements',
      entitlements,
      '--sign',
      identity,
      appPath,
    ]);
  });

  test('an ad-hoc signature asks for no timestamp', () => {
    const args = buildCodesignArgs('-', appPath, entitlements);
    expect(args).not.toContain('--timestamp');
    expect(args.slice(-2)).toEqual(['-', appPath]);
  });
});

describe('codesignEntitlements', () => {
  test('grants the JIT/FFI exceptions Bun needs under the hardened runtime', () => {
    const xml = codesignEntitlements();
    expect(xml).toContain('com.apple.security.cs.allow-jit');
    expect(xml).toContain('com.apple.security.cs.allow-unsigned-executable-memory');
    expect(xml).toContain('com.apple.security.cs.disable-library-validation');
  });
});

describe('buildCodesignVerifyArgs', () => {
  test('verifies strictly against the app bundle path', () => {
    const appPath = '/tmp/out/My App.app';
    expect(buildCodesignVerifyArgs(appPath)).toEqual(['--verify', '--strict', appPath]);
  });
});

describe('buildNotarizeArgs', () => {
  test('builds an xcrun notarytool submit argv with the credentials', () => {
    const args = buildNotarizeArgs({
      appPath: '/tmp/out/My App.app',
      appleId: 'dev@example.com',
      teamId: 'TEAMID123',
      password: 'app-specific-pw',
    });
    expect(args).toEqual([
      'xcrun',
      'notarytool',
      'submit',
      '/tmp/out/My App.app',
      '--apple-id',
      'dev@example.com',
      '--team-id',
      'TEAMID123',
      '--password',
      'app-specific-pw',
      '--wait',
    ]);
  });
});

describe('buildStapleArgs', () => {
  test('builds an xcrun stapler staple argv for the app bundle', () => {
    expect(buildStapleArgs('/tmp/out/My App.app')).toEqual([
      'xcrun',
      'stapler',
      'staple',
      '/tmp/out/My App.app',
    ]);
  });
});
