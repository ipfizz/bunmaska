import { describe, expect, test } from 'bun:test';

describe('toolchain sanity', () => {
  test('bun:test is wired up correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
