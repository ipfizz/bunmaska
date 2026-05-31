import { describe, expect, test } from 'bun:test';
import { parseArgs, resolveTarget } from '../../../src/cli/parse-args';
import { currentPlatform } from '../../../src/common/platform';

describe('parseArgs --target', () => {
  test('build without --target leaves target unset (host default applied later)', () => {
    const cmd = parseArgs(['build', 'app.ts']);
    expect(cmd.kind).toBe('build');
    if (cmd.kind === 'build') {
      expect(cmd.options.target).toBeUndefined();
    }
  });

  test('build accepts an explicit --target macos', () => {
    const cmd = parseArgs(['build', 'app.ts', '--target', 'macos']);
    expect(cmd.kind).toBe('build');
    if (cmd.kind === 'build') {
      expect(cmd.options.target).toBe('macos');
    }
  });

  test('build accepts an explicit --target linux', () => {
    const cmd = parseArgs(['build', 'app.ts', '--target', 'linux']);
    expect(cmd.kind).toBe('build');
    if (cmd.kind === 'build') {
      expect(cmd.options.target).toBe('linux');
    }
  });

  test('build rejects an invalid --target value', () => {
    const cmd = parseArgs(['build', 'app.ts', '--target', 'windows']);
    expect(cmd.kind).toBe('error');
    if (cmd.kind === 'error') {
      expect(cmd.message).toMatch(/--target/);
    }
  });

  test('build parses --target alongside the other flags', () => {
    expect(
      parseArgs([
        'build',
        'app.ts',
        '--target',
        'linux',
        '--name',
        'My App',
        '--id',
        'com.example.app',
        '--out',
        'dist',
        '--icon',
        'icon.png',
      ]),
    ).toEqual({
      kind: 'build',
      entry: 'app.ts',
      options: {
        name: 'My App',
        id: 'com.example.app',
        out: 'dist',
        icon: 'icon.png',
        target: 'linux',
      },
    });
  });
});

describe('resolveTarget', () => {
  test('defaults an unset target to the host platform', () => {
    const expected = currentPlatform() === 'macos' ? 'macos' : 'linux';
    expect(resolveTarget(undefined)).toBe(expected);
  });

  test('passes through an explicit target', () => {
    expect(resolveTarget('linux')).toBe('linux');
    expect(resolveTarget('macos')).toBe('macos');
  });
});
