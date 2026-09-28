import { describe, expect, test } from 'bun:test';

describe('package exports', () => {
  test.each([
    'bunmaska',
    'bunmaska/main',
    'bunmaska/renderer',
    'bunmaska/config',
    'bunmaska/electron',
  ])('%s resolves for require(), not only import', (specifier) => {
    expect(require.resolve(specifier)).toEndWith('.ts');
  });
});
