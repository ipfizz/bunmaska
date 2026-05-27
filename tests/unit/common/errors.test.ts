import { describe, expect, test } from 'bun:test';
import { SambarError } from '../../../src/common/errors';

describe('SambarError', () => {
  test('is an instance of Error', () => {
    expect(new SambarError('boom')).toBeInstanceOf(Error);
  });

  test('is an instance of SambarError', () => {
    expect(new SambarError('boom')).toBeInstanceOf(SambarError);
  });

  test('preserves the message', () => {
    expect(new SambarError('boom').message).toBe('boom');
  });

  test('has name of "SambarError"', () => {
    expect(new SambarError('boom').name).toBe('SambarError');
  });

  test('exposes the cause when provided', () => {
    const cause = new Error('root');
    expect(new SambarError('wrapped', { cause }).cause).toBe(cause);
  });

  test('cause is undefined when not provided', () => {
    expect(new SambarError('boom').cause).toBeUndefined();
  });
});
