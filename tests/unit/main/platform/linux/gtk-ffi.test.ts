import { describe, expect, test } from 'bun:test';
import { SambarError } from '../../../../../src/common/errors';
import { currentPlatform } from '../../../../../src/common/platform';
import { loadGtkFFI } from '../../../../../src/main/platform/linux/gtk-ffi';

describe('loadGtkFFI export', () => {
  test('is a function', () => {
    expect(typeof loadGtkFFI).toBe('function');
  });
});

if (currentPlatform() !== 'linux') {
  describe('loadGtkFFI on non-Linux hosts', () => {
    test('throws SambarError', () => {
      expect(() => loadGtkFFI()).toThrow(SambarError);
    });

    test('error message mentions the current platform', () => {
      expect(() => loadGtkFFI()).toThrow(/only supported on Linux/);
    });
  });
}
