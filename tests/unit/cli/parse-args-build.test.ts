import { describe, expect, test } from 'bun:test';
import { type BuildOptions, parseArgs, resolveTarget } from '../../../src/cli/parse-args';
import { currentPlatform } from '../../../src/common/platform';

describe('parseArgs build flags', () => {
  test.each<[string[], BuildOptions]>([
    [
      ['--sign', 'Developer ID Application: Jane Doe (TEAMID123)'],
      { sign: 'Developer ID Application: Jane Doe (TEAMID123)' },
    ],
    [['--sign', '-'], { sign: '-' }],
    [['--notarize'], { notarize: true }],
    [['--dmg'], { dmg: true }],
    [['--update'], { update: true }],
    [['--channel', 'canary'], { channel: 'canary' }],
    [['--update-key', 'keys/private.pem'], { updateKey: 'keys/private.pem' }],
    [['--embed-engine', 'engines/wk'], { embedEngine: 'engines/wk' }],
    [['--target', 'macos'], { target: 'macos' }],
    [['--target', 'linux'], { target: 'linux' }],
    [['--target', 'windows'], { target: 'windows' }],
  ])('%p', (flags, options) => {
    expect(parseArgs(['build', 'app.ts', ...flags])).toEqual({
      kind: 'build',
      entry: 'app.ts',
      options,
    });
  });

  test.each([
    ['--sign'],
    ['--channel'],
    ['--update-key'],
    ['--target'],
  ])('%s without a value is an error naming it', (flag) => {
    const command = parseArgs(['build', 'app.ts', flag]);
    expect(command).toEqual({
      kind: 'error',
      message: `bunmaska build: flag ${flag} requires a value`,
    });
  });

  test('rejects an unknown --target', () => {
    const command = parseArgs(['build', 'app.ts', '--target', 'freebsd']);
    expect(command.kind).toBe('error');
    if (command.kind === 'error') {
      expect(command.message).toContain('freebsd');
    }
  });
});

describe('resolveTarget', () => {
  test('defaults an unset target to the host platform', () => {
    expect(resolveTarget(undefined)).toBe(currentPlatform());
  });

  test('passes through an explicit target', () => {
    expect(resolveTarget('windows')).toBe('windows');
  });
});
