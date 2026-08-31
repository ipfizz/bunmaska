import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../../../src/cli/parse-args';

describe('parseArgs build --update / --channel', () => {
  test('build without --update leaves update unset', () => {
    const cmd = parseArgs(['build', 'app.ts']);
    expect(cmd.kind).toBe('build');
    if (cmd.kind === 'build') {
      expect(cmd.options.update).toBeUndefined();
      expect(cmd.options.channel).toBeUndefined();
    }
  });

  test('build accepts --update and --channel', () => {
    const cmd = parseArgs(['build', 'app.ts', '--update', '--channel', 'canary']);
    expect(cmd.kind).toBe('build');
    if (cmd.kind === 'build') {
      expect(cmd.options.update).toBe(true);
      expect(cmd.options.channel).toBe('canary');
    }
  });

  test('--channel requires a value', () => {
    const cmd = parseArgs(['build', 'app.ts', '--channel']);
    expect(cmd.kind).toBe('error');
  });
});

describe('parseArgs build --update-key', () => {
  test('accepts --update-key with a path', () => {
    const cmd = parseArgs(['build', 'app.ts', '--update', '--update-key', 'keys/private.pem']);
    expect(cmd.kind).toBe('build');
    if (cmd.kind === 'build') {
      expect(cmd.options.update).toBe(true);
      expect(cmd.options.updateKey).toBe('keys/private.pem');
    }
  });

  test('--update-key requires a value', () => {
    const cmd = parseArgs(['build', 'app.ts', '--update-key']);
    expect(cmd.kind).toBe('error');
  });
});

describe('parseArgs keygen', () => {
  test('bare keygen has no out dir', () => {
    expect(parseArgs(['keygen'])).toEqual({ kind: 'keygen' });
  });

  test('keygen --out <dir> carries the directory', () => {
    expect(parseArgs(['keygen', '--out', 'keys'])).toEqual({ kind: 'keygen', out: 'keys' });
  });

  test('keygen --out without a value is an error', () => {
    expect(parseArgs(['keygen', '--out']).kind).toBe('error');
  });

  test('keygen rejects stray arguments', () => {
    expect(parseArgs(['keygen', 'extra']).kind).toBe('error');
  });
});
