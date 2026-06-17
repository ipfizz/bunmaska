import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../src/common/errors';
import {
  type Arch,
  currentArch,
  currentPlatform,
  isSupported,
  mapArch,
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

  test('throws BunmaskaError on unknown platform tag', () => {
    expect(() => mapPlatform('freebsd')).toThrow(BunmaskaError);
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

describe('mapArch', () => {
  test('maps x64 and arm64 through', () => {
    expect(mapArch('x64')).toBe('x64');
    expect(mapArch('arm64')).toBe('arm64');
  });

  test('throws BunmaskaError on an unsupported arch', () => {
    expect(() => mapArch('ia32')).toThrow(BunmaskaError);
    expect(() => mapArch('ia32')).toThrow(/Unsupported architecture: ia32/);
  });
});

describe('currentArch', () => {
  test('returns a valid Arch tag for the host', () => {
    const valid: ReadonlyArray<Arch> = ['x64', 'arm64'];
    expect(valid).toContain(currentArch());
  });
});
