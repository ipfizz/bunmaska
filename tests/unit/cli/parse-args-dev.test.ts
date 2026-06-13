import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../../../src/cli/parse-args';

describe('parseArgs dev', () => {
  test('dev with no entry omits it (config-resolved later)', () => {
    expect(parseArgs(['dev'])).toEqual({ kind: 'dev' });
  });

  test('dev with an entry carries it', () => {
    expect(parseArgs(['dev', 'src/app.ts'])).toEqual({ kind: 'dev', entry: 'src/app.ts' });
  });

  test('dev with extra arguments errors', () => {
    const command = parseArgs(['dev', 'a.ts', 'b.ts']);
    expect(command.kind).toBe('error');
    if (command.kind === 'error') {
      expect(command.message).toContain('unexpected argument b.ts');
    }
  });
});
