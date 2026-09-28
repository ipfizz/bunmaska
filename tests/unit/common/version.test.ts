import { describe, expect, test } from 'bun:test';
import { BUNMASKA_VERSION } from '../../../src/common/version';

describe('BUNMASKA_VERSION', () => {
  test('is shaped like semver', () => {
    expect(BUNMASKA_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  });
});
