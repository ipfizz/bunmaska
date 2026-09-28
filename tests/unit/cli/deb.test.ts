import { describe, expect, test } from 'bun:test';
import {
  buildArArchive,
  buildControlFile,
  DEFAULT_LINUX_DEPENDS,
  debFileName,
  debMaintainer,
} from '../../../src/cli/deb';

describe('debFileName', () => {
  test('deb is <slug>_<version>_amd64.deb', () => {
    expect(debFileName('My App', '1.2.3', 'x64')).toBe('my-app_1.2.3_amd64.deb');
    expect(debFileName('My App', '1.2.3', 'arm64')).toBe('my-app_1.2.3_arm64.deb');
  });

  test('deb names a prerelease with the Debian tilde', () => {
    expect(debFileName('My App', '1.0.0-beta.1', 'x64')).toBe('my-app_1.0.0~beta.1_amd64.deb');
  });
});

describe('buildControlFile', () => {
  const text = buildControlFile({
    arch: 'amd64',
    slug: 'my-app',
    version: '1.0.0',
    maintainer: 'Bunmaska <noreply@bunmaska.dev>',
    description: 'My App built with Bunmaska',
  });

  test('emits the debian control fields', () => {
    expect(text).toContain('Package: my-app');
    expect(text).toContain('Version: 1.0.0');
    expect(text).toContain('Architecture: amd64');
    expect(text).toContain('Maintainer: Bunmaska <noreply@bunmaska.dev>');
    expect(text).toContain('Description: My App built with Bunmaska');
    expect(text).toContain('Recommends: libnotify4');
  });

  test('maps a semver prerelease to a tilde so the final release sorts above it', () => {
    const pre = buildControlFile({
      slug: 'my-app',
      version: '1.0.0-beta.1',
      maintainer: 'x <x@example.com>',
      description: 'x',
    });
    expect(pre).toContain('Version: 1.0.0~beta.1\n');
  });

  test('ends with a trailing newline', () => {
    expect(text.endsWith('\n')).toBe(true);
  });

  test('emits a Depends line on the system WebKitGTK when given deps (the bug fix)', () => {
    const withDeps = buildControlFile({
      slug: 'my-app',
      version: '1.0.0',
      maintainer: 'Bunmaska <noreply@bunmaska.dev>',
      description: 'My App built with Bunmaska',
      depends: DEFAULT_LINUX_DEPENDS,
    });
    expect(withDeps).toContain('Depends: libwebkitgtk-6.0-4, libgtk-4-1');
    // Depends precedes Description (Debian field ordering).
    expect(withDeps.indexOf('Depends:')).toBeLessThan(withDeps.indexOf('Description:'));
  });

  test('omits the Depends field entirely when deps are empty', () => {
    const noDeps = buildControlFile({
      slug: 'my-app',
      version: '1.0.0',
      maintainer: 'Bunmaska <noreply@bunmaska.dev>',
      description: 'x',
      depends: [],
    });
    expect(noDeps).not.toContain('Depends:');
  });
});

describe('buildArArchive', () => {
  test('pads an odd-length member so the next header starts on an even offset', () => {
    const ar = buildArArchive([
      { name: 'a', content: new Uint8Array([1, 2, 3]) },
      { name: 'b', content: new Uint8Array([4]) },
    ]);
    const text = new TextDecoder('latin1').decode(ar);
    expect(text.startsWith('!<arch>\n')).toBe(true);
    expect(text.slice(8 + 48, 8 + 58).trim()).toBe('3');
    expect(ar[8 + 60 + 3]).toBe(0x0a);
    expect(text.slice(8 + 60 + 4, 8 + 60 + 5)).toBe('b');
    expect(ar.length).toBe(8 + 60 + 4 + 60 + 2);
  });
});

describe('debMaintainer', () => {
  test("reads package.json's author string and object forms", () => {
    expect(debMaintainer('Ada Lovelace <ada@example.com> (https://ada.dev)')).toBe(
      'Ada Lovelace <ada@example.com>',
    );
    expect(debMaintainer({ name: 'Ada Lovelace', email: 'ada@example.com' })).toBe(
      'Ada Lovelace <ada@example.com>',
    );
  });

  test('is undefined for an author without an email, which Debian requires', () => {
    expect(debMaintainer('Ada Lovelace')).toBeUndefined();
    expect(debMaintainer({ name: 'Ada Lovelace' })).toBeUndefined();
    expect(debMaintainer(undefined)).toBeUndefined();
  });
});
