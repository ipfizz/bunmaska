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
