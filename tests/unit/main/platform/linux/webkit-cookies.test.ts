import { describe, expect, test } from 'bun:test';
import { maxAgeFor } from '../../../../../src/main/platform/linux/webkit-cookies';

describe('maxAgeFor', () => {
  const now = 1_700_000_000;

  test('a session cookie has no max-age', () => {
    expect(maxAgeFor(undefined, now)).toBe(-1);
  });

  test('a future expiry becomes the seconds until it', () => {
    expect(maxAgeFor(now + 3600, now)).toBe(3600);
  });

  test('a past expiry becomes 0 so the cookie expires', () => {
    expect(maxAgeFor(now - 10, now)).toBe(0);
  });

  test('a year-9999 expiry clamps to the i32 max instead of wrapping negative', () => {
    expect(maxAgeFor(253402300799, now)).toBe(0x7fffffff);
  });
});
