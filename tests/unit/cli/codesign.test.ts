import { describe, expect, test } from 'bun:test';
import {
  buildCodesignArgs,
  buildCodesignVerifyArgs,
  buildNotarizeArgs,
  buildStapleArgs,
} from '../../../src/cli/build-macos';

describe('buildCodesignArgs', () => {
  const appPath = '/tmp/out/My App.app';

  test('forces a deep signature with the hardened runtime for a real identity', () => {
    const identity = 'Developer ID Application: Jane Doe (TEAMID123)';
    const args = buildCodesignArgs(identity, appPath);
    expect(args).toEqual([
      '--force',
      '--deep',
      '--options',
      'runtime',
      '--sign',
      identity,
      appPath,
    ]);
  });

  test('enables the hardened runtime via --options runtime', () => {
    const args = buildCodesignArgs('-', appPath);
    const optionsIndex = args.indexOf('--options');
    expect(optionsIndex).toBeGreaterThanOrEqual(0);
    expect(args[optionsIndex + 1]).toBe('runtime');
  });

  test('passes the identity verbatim right after --sign', () => {
    const identity = 'Developer ID Application: Jane Doe (TEAMID123)';
    const args = buildCodesignArgs(identity, appPath);
    const signIndex = args.indexOf('--sign');
    expect(signIndex).toBeGreaterThanOrEqual(0);
    expect(args[signIndex + 1]).toBe(identity);
  });

  test('passes the ad-hoc - identity through unchanged', () => {
    const args = buildCodesignArgs('-', appPath);
    const signIndex = args.indexOf('--sign');
    expect(args[signIndex + 1]).toBe('-');
  });

  test('targets the app bundle path as the final argument', () => {
    const args = buildCodesignArgs('-', appPath);
    expect(args.at(-1)).toBe(appPath);
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
