import { describe, expect, test } from 'bun:test';
import {
  currentPlatform,
  isSupported,
  mapPlatform,
  type Platform,
} from '../../../src/common/platform';

describe('mapPlatform', () => {
  test('maps darwin to macos', () => {
    expect(mapPlatform('darwin')).toBe('macos');
  });

  test('maps linux to linux', () => {
    expect(mapPlatform('linux')).toBe('linux');
  });

  test('maps win32 to windows', () => {
    expect(mapPlatform('win32')).toBe('windows');
  });

  test('throws on unknown platform tag', () => {
    expect(() => mapPlatform('freebsd')).toThrow(/Unsupported platform: freebsd/);
  });
});

describe('isSupported', () => {
  test('macos is supported', () => {
    expect(isSupported('macos')).toBe(true);
  });

  test('linux is supported', () => {
    expect(isSupported('linux')).toBe(true);
  });

  test('windows is not supported', () => {
    expect(isSupported('windows')).toBe(false);
  });
});

describe('currentPlatform', () => {
  test('returns a valid Platform tag for the host', () => {
    const p = currentPlatform();
    const valid: ReadonlyArray<Platform> = ['macos', 'linux', 'windows'];
    expect(valid).toContain(p);
  });
});
