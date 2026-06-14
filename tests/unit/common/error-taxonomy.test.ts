import { describe, expect, test } from 'bun:test';
import {
  FFIError,
  InvalidArgumentError,
  BunmaskaError,
  UnsupportedPlatformError,
} from '../../../src/common/errors';

describe('BunmaskaError.code', () => {
  test('is undefined by default', () => {
    expect(new BunmaskaError('x').code).toBeUndefined();
  });

  test('can be supplied via options', () => {
    expect(new BunmaskaError('x', { code: 'ERR_CUSTOM' }).code).toBe('ERR_CUSTOM');
  });
});

describe('UnsupportedPlatformError', () => {
  test('extends BunmaskaError', () => {
    expect(new UnsupportedPlatformError('windows')).toBeInstanceOf(BunmaskaError);
  });

  test('has a stable code and descriptive name', () => {
    const e = new UnsupportedPlatformError('windows');
    expect(e.code).toBe('ERR_UNSUPPORTED_PLATFORM');
    expect(e.name).toBe('UnsupportedPlatformError');
  });

  test('mentions the offending platform in the message', () => {
    expect(new UnsupportedPlatformError('windows').message).toMatch(/windows/);
  });
});

describe('FFIError', () => {
  test('extends BunmaskaError with the ERR_FFI code', () => {
    const e = new FFIError('libobjc failed to load');
    expect(e).toBeInstanceOf(BunmaskaError);
    expect(e.code).toBe('ERR_FFI');
    expect(e.name).toBe('FFIError');
  });

  test('preserves an underlying cause', () => {
    const cause = new Error('dlopen');
    expect(new FFIError('wrap', { cause }).cause).toBe(cause);
  });
});

describe('InvalidArgumentError', () => {
  test('extends BunmaskaError with the ERR_INVALID_ARGUMENT code', () => {
    const e = new InvalidArgumentError('width must be positive');
    expect(e).toBeInstanceOf(BunmaskaError);
    expect(e.code).toBe('ERR_INVALID_ARGUMENT');
    expect(e.name).toBe('InvalidArgumentError');
  });
});
