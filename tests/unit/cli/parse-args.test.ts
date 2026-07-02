import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../../../src/cli/parse-args';

describe('parseArgs', () => {
  test('no args yields the help command', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
  });

  test('--help yields the help command', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseArgs(['help'])).toEqual({ kind: 'help' });
  });

  test('--version yields the version command', () => {
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
  });

  test('run requires an entry', () => {
    const cmd = parseArgs(['run']);
    expect(cmd.kind).toBe('error');
    if (cmd.kind === 'error') {
      expect(cmd.message).toMatch(/entry/i);
    }
  });

  test('run captures the entry and passes through trailing args', () => {
    expect(parseArgs(['run', 'app.ts'])).toEqual({
      kind: 'run',
      entry: 'app.ts',
      args: [],
    });
    expect(parseArgs(['run', 'app.ts', '--foo', 'bar', '-x'])).toEqual({
      kind: 'run',
      entry: 'app.ts',
      args: ['--foo', 'bar', '-x'],
    });
  });

  test('build without an entry parses; the entry resolves from config at dispatch', () => {
    expect(parseArgs(['build'])).toEqual({ kind: 'build', options: {} });
  });

  test('build captures the entry with default options', () => {
    expect(parseArgs(['build', 'app.ts'])).toEqual({
      kind: 'build',
      entry: 'app.ts',
      options: {},
    });
  });

  test('build parses --name --id --out --icon flags', () => {
    expect(
      parseArgs([
        'build',
        'app.ts',
        '--name',
        'My App',
        '--id',
        'com.example.app',
        '--out',
        'dist',
        '--icon',
        'icon.icns',
      ]),
    ).toEqual({
      kind: 'build',
      entry: 'app.ts',
      options: {
        name: 'My App',
        id: 'com.example.app',
        out: 'dist',
        icon: 'icon.icns',
      },
    });
  });

  test('build flags may appear before the entry', () => {
    expect(parseArgs(['build', '--name', 'My App', 'app.ts'])).toEqual({
      kind: 'build',
      entry: 'app.ts',
      options: { name: 'My App' },
    });
  });

  test('build with a flag missing its value is an error', () => {
    const cmd = parseArgs(['build', 'app.ts', '--name']);
    expect(cmd.kind).toBe('error');
    if (cmd.kind === 'error') {
      expect(cmd.message).toMatch(/--name/);
    }
  });

  test('build with an unknown flag is an error', () => {
    const cmd = parseArgs(['build', 'app.ts', '--nope', 'x']);
    expect(cmd.kind).toBe('error');
    if (cmd.kind === 'error') {
      expect(cmd.message).toMatch(/--nope/);
    }
  });

  test('an unknown subcommand is an error', () => {
    const cmd = parseArgs(['frobnicate']);
    expect(cmd.kind).toBe('error');
    if (cmd.kind === 'error') {
      expect(cmd.message).toMatch(/frobnicate/);
    }
  });
});
