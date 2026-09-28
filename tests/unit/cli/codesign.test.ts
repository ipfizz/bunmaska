import { describe, expect, test } from 'bun:test';
import {
  buildCodesignArgs,
  buildCodesignVerifyArgs,
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
  test('grants allow-jit, without which bun:ffi refuses to load under the hardened runtime', () => {
    expect(codesignEntitlements()).toContain(
      '<key>com.apple.security.cs.allow-jit</key>\n  <true/>',
    );
  });
});

describe('buildCodesignVerifyArgs', () => {
  test('verifies strictly against the app bundle path', () => {
    const appPath = '/tmp/out/My App.app';
    expect(buildCodesignVerifyArgs(appPath)).toEqual(['--verify', '--strict', appPath]);
  });
});
