import { describe, expect, test } from 'bun:test';
import { budgetProblems, LEGS, parseCounts } from '../../../scripts/check-test-budget';

describe('parseCounts', () => {
  test('reads the final summary, not count-like lines a test printed earlier', () => {
    const stderr = [
      'bun test v1.4.2',
      ' 3 pass',
      'retrying: 0 failures so far',
      '',
      ' 1623 pass',
      ' 76 skip',
      ' 0 fail',
      'Ran 1699 tests across 237 files.',
    ].join('\n');
    expect(parseCounts(stderr)).toEqual({ pass: 1623, skip: 76, fail: 0 });
  });

  test('treats the skip line bun omits at zero as zero skips', () => {
    expect(parseCounts(' 5 pass\n 0 fail\n')).toEqual({ pass: 5, skip: 0, fail: 0 });
  });
});

describe('budgetProblems', () => {
  test('a green run whose integration tier vanished fails the darwin budget', () => {
    const darwin = LEGS['darwin'];
    if (darwin === undefined) {
      throw new Error('no darwin leg');
    }
    // The unit tier alone passed 1414 on macOS: a lost integration tier must not pass.
    expect(budgetProblems(darwin, { pass: 1414, skip: 4, fail: 0 }, 0)).toHaveLength(1);
    expect(budgetProblems(darwin, { pass: 1838, skip: 103, fail: 0 }, 0)).toEqual([]);
  });

  test('an unparseable summary fails even when the run exited 0', () => {
    const problems = budgetProblems(
      { minPass: 0, maxSkip: 0 },
      { pass: Number.NaN, skip: 0, fail: Number.NaN },
      0,
    );
    expect(problems.join(' ')).toContain('could not parse');
  });
});
