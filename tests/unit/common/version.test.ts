import { describe, expect, test } from 'bun:test';
import pkg from '../../../package.json';
import { BUNMASKA_VERSION } from '../../../src/common/version';

describe('BUNMASKA_VERSION', () => {
  test('is a non-empty string', () => {
    expect(typeof BUNMASKA_VERSION).toBe('string');
    expect(BUNMASKA_VERSION.length).toBeGreaterThan(0);
  });

  test('matches the version field in package.json', () => {
    expect(BUNMASKA_VERSION).toBe(pkg.version);
  });

  test('is shaped like semver', () => {
    expect(BUNMASKA_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  });
});
