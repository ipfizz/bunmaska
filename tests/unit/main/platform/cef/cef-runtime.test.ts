import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { cefProfilePath } from '../../../../../src/main/platform/cef/cef-runtime';

describe('cefProfilePath', () => {
  test("is not userData, where requestSingleInstanceLock keeps Chromium's lock file names", () => {
    const userData = join('/Users', 'me', 'Library', 'Application Support', 'Demo');
    expect(cefProfilePath(userData)).not.toBe(userData);
    expect(dirname(cefProfilePath(userData))).toBe(userData);
  });
});
