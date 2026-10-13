import { ptr } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { readCefString, writeCefString } from '../../../../../src/main/platform/cef/cef-ffi';

describe('cef_string_t', () => {
  test('a written string reads back, surrogate pairs included, with no destructor', () => {
    const keep: unknown[] = [];
    const struct = Buffer.alloc(24);
    writeCefString(struct, 0, 'Blink 😀', keep);
    expect(struct.readBigUInt64LE(8)).toBe(8n);
    expect(struct.readBigUInt64LE(16)).toBe(0n);
    expect(readCefString(Number(ptr(struct)))).toBe('Blink 😀');
  });

  test('NULL and empty strings read as empty', () => {
    expect(readCefString(0)).toBe('');
    expect(readCefString(Number(ptr(Buffer.alloc(24))))).toBe('');
  });
});
