import { describe, expect, test } from 'bun:test';
import { idleStateFrom } from '../../../../src/main/platform/idle-state';

describe('idleStateFrom', () => {
  test('lock wins over idle time', () => {
    expect(idleStateFrom(0, 1, true)).toBe('locked');
    expect(idleStateFrom(100, 1, true)).toBe('locked');
  });

  test('idle when seconds meet the threshold', () => {
    expect(idleStateFrom(10, 10, false)).toBe('idle');
    expect(idleStateFrom(11, 10, false)).toBe('idle');
  });

  test('active when below the threshold', () => {
    expect(idleStateFrom(9, 10, false)).toBe('active');
    expect(idleStateFrom(0, 1, false)).toBe('active');
  });

  test('unknown for a non-finite idle or threshold', () => {
    expect(idleStateFrom(Number.NaN, 10, false)).toBe('unknown');
    expect(idleStateFrom(-1, 10, false)).toBe('unknown');
    expect(idleStateFrom(5, Number.NaN, false)).toBe('unknown');
  });
});
