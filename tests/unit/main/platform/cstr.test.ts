import { describe, expect, test } from 'bun:test';
import { cstr } from '../../../../src/main/platform/cstr';

describe('cstr', () => {
  test('returns a Uint8Array', () => {
    expect(cstr('x')).toBeInstanceOf(Uint8Array);
  });

  test('null-terminates the output', () => {
    const bytes = cstr('hello');
    expect(bytes[bytes.length - 1]).toBe(0);
  });

  test('encodes ASCII characters correctly', () => {
    expect(Array.from(cstr('alloc'))).toEqual([97, 108, 108, 111, 99, 0]);
  });

  test('encodes the empty string as a single null byte', () => {
    expect(Array.from(cstr(''))).toEqual([0]);
  });

  test('encodes UTF-8 multi-byte characters correctly', () => {
    expect(Array.from(cstr('café'))).toEqual([99, 97, 102, 195, 169, 0]);
  });

  test('does not include a stray null when the input already ends in something else', () => {
    const bytes = cstr('a');
    expect(bytes).toHaveLength(2);
    expect(bytes[0]).toBe(97);
    expect(bytes[1]).toBe(0);
  });
});
