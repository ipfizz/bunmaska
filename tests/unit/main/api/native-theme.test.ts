import { describe, expect, test } from 'bun:test';
import { nativeTheme } from '../../../../src/main/api/native-theme';

describe('nativeTheme', () => {
  test('exposes a boolean shouldUseDarkColors', () => {
    expect(typeof nativeTheme.shouldUseDarkColors).toBe('boolean');
  });
});
