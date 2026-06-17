import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../../../src/cli/parse-args';

describe('parseArgs init', () => {
  test('init with no dir defaults to "."', () => {
    expect(parseArgs(['init'])).toEqual({ kind: 'init', dir: '.' });
  });

  test('init with a dir uses it', () => {
    expect(parseArgs(['init', 'my-app'])).toEqual({ kind: 'init', dir: 'my-app' });
  });

  test('init with extra arguments errors', () => {
    const command = parseArgs(['init', 'a', 'b']);
    expect(command.kind).toBe('error');
    if (command.kind === 'error') {
      expect(command.message).toContain('unexpected argument b');
    }
  });
});
