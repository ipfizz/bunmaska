import { describe, expect, test } from 'bun:test';
import { cefEngineId, pickCefBuild } from '../../../../tools/engine/build-cef-engine';

const version = (cef: string, chromium: string, channel: string) => ({
  cef_version: `${cef}+gabc+chromium-${chromium}`,
  chromium_version: chromium,
  channel,
  files: [
    { type: 'standard', name: `std-${cef}`, sha1: 'aaa' },
    { type: 'minimal', name: `min-${cef}`, sha1: `sha-${cef}` },
  ],
});

const index = {
  macosarm64: {
    versions: [
      version('155.0.1', '155.0.1.1', 'beta'),
      version('154.0.28', '154.0.8037.58', 'stable'),
      version('153.0.9', '153.0.1.9', 'stable'),
    ],
  },
};

describe('pickCefBuild', () => {
  test('takes the newest stable minimal build by default', () => {
    expect(pickCefBuild(index, 'macosarm64')).toEqual({
      cefVersion: '154.0.28+gabc+chromium-154.0.8037.58',
      chromiumVersion: '154.0.8037.58',
      file: 'min-154.0.28',
      sha1: 'sha-154.0.28',
    });
  });

  test('a wanted CEF version matches on the full version, not a prefix of it', () => {
    expect(pickCefBuild(index, 'macosarm64', '153.0.9').file).toBe('min-153.0.9');
    expect(() => pickCefBuild(index, 'macosarm64', '153.0')).toThrow('no CEF minimal build');
  });

  test('an unknown platform fails loudly', () => {
    expect(() => pickCefBuild(index, 'linux64')).toThrow('no CEF minimal build for linux64');
  });
});

describe('cefEngineId', () => {
  test('drops the CEF build hash and keeps the Chromium version as upstream', () => {
    const build = pickCefBuild(index, 'macosarm64');
    expect(cefEngineId(build, 'macos', 'arm64')).toBe(
      'cef-154.0.28-154.0.8037.58-bunmaska1-macos-arm64',
    );
  });

  test('refuses an index entry that would mint a malformed id', () => {
    const build = { ...pickCefBuild(index, 'macosarm64'), chromiumVersion: '154-beta' };
    expect(() => cefEngineId(build, 'macos', 'arm64')).toThrow('engine-id');
  });
});
