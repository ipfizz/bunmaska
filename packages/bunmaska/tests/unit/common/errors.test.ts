import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../src/common/errors';

describe('BunmaskaError', () => {
  test('is an instance of Error', () => {
    expect(new BunmaskaError('boom')).toBeInstanceOf(Error);
  });

  test('is an instance of BunmaskaError', () => {
    expect(new BunmaskaError('boom')).toBeInstanceOf(BunmaskaError);
  });

  test('preserves the message', () => {
    expect(new BunmaskaError('boom').message).toBe('boom');
  });

  test('has name of "BunmaskaError"', () => {
    expect(new BunmaskaError('boom').name).toBe('BunmaskaError');
  });

  test('exposes the cause when provided', () => {
    const cause = new Error('root');
    expect(new BunmaskaError('wrapped', { cause }).cause).toBe(cause);
  });

  test('cause is undefined when not provided', () => {
    expect(new BunmaskaError('boom').cause).toBeUndefined();
  });
});
