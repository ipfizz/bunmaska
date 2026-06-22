import { describe, expect, test } from 'bun:test';
import {
  artifactBaseName,
  artifactFileName,
  compareVersions,
  contentHash,
  isNewerVersion,
  parseUpdateManifest,
  serializeUpdateManifest,
  slugifyName,
  type UpdateManifest,
} from '../../../src/common/manifest';

describe('slugifyName', () => {
  test('lowercases and dashes non-alphanumerics', () => {
    expect(slugifyName('My App!')).toBe('my-app');
    expect(slugifyName('  Cool__Tool  ')).toBe('cool-tool');
  });

  test('falls back to "app" for an empty slug', () => {
    expect(slugifyName('!!!')).toBe('app');
    expect(slugifyName('')).toBe('app');
  });
});

describe('artifact naming', () => {
  const spec = { name: 'My App', channel: 'stable', os: 'macos', arch: 'arm64' } as const;

  test('artifactBaseName is name-channel-os-arch with a slugged name', () => {
    expect(artifactBaseName(spec)).toBe('my-app-stable-macos-arm64');
  });

  test('artifactFileName appends the extension and strips leading dots', () => {
    expect(artifactFileName(spec, 'tar.zst')).toBe('my-app-stable-macos-arm64.tar.zst');
    expect(artifactFileName(spec, '.zip')).toBe('my-app-stable-macos-arm64.zip');
  });
});

describe('contentHash', () => {
  test('is a stable 16-char hex digest', () => {
    const h = contentHash('hello world');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash('hello world')).toBe(h);
  });

  test('differs for different content', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });

  test('matches across string and byte forms of the same content', () => {
    const bytes = new TextEncoder().encode('hello world');
    expect(contentHash(bytes)).toBe(contentHash('hello world'));
  });
});

describe('compareVersions', () => {
  test('orders main segments numerically', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  test('treats missing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });

  test('ignores +build metadata', () => {
    expect(compareVersions('1.0.0+abc', '1.0.0+def')).toBe(0);
  });

  test('a release outranks its prerelease', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
  });

  test('orders prerelease identifiers by precedence', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.2')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.1.1')).toBe(-1);
    // Numeric identifiers rank below alphanumeric ones.
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
  });
});

describe('isNewerVersion', () => {
  test('is true only for a strictly newer remote', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
  });
});

describe('parseUpdateManifest / serializeUpdateManifest', () => {
  const sample: UpdateManifest = {
    name: 'My App',
    version: '2.0.0',
    channel: 'stable',
    os: 'macos',
    arch: 'arm64',
    hash: 'deadbeefdeadbeef',
    size: 1234,
    artifact: 'my-app-stable-macos-arm64.tar.zst',
  };

  test('round-trips a valid manifest', () => {
    expect(parseUpdateManifest(serializeUpdateManifest(sample))).toEqual(sample);
  });

  test('rejects non-JSON', () => {
    expect(() => parseUpdateManifest('<html>')).toThrow(/not valid JSON/);
  });

  test('rejects a missing required field', () => {
    const { version: _omitted, ...rest } = sample;
    expect(() => parseUpdateManifest(JSON.stringify(rest))).toThrow(/"version"/);
  });

  test('accepts windows as an os', () => {
    const win = {
      ...sample,
      os: 'windows',
      arch: 'x64',
      artifact: 'my-app-stable-windows-x64.zip',
    } as const;
    expect(parseUpdateManifest(serializeUpdateManifest(win))).toEqual(win);
  });

  test('rejects an unknown os/arch', () => {
    expect(() => parseUpdateManifest(JSON.stringify({ ...sample, os: 'freebsd' }))).toThrow(/"os"/);
    expect(() => parseUpdateManifest(JSON.stringify({ ...sample, arch: 'riscv' }))).toThrow(
      /"arch"/,
    );
  });

  test('rejects a non-numeric size', () => {
    expect(() => parseUpdateManifest(JSON.stringify({ ...sample, size: 'big' }))).toThrow(/"size"/);
  });
});
