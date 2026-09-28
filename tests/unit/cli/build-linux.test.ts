import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildArArchive,
  buildControlFile,
  buildLinuxApp,
  buildDesktopEntry,
  debFileName,
  DEFAULT_LINUX_DEPENDS,
  linuxLayout,
  debMaintainer,
  resolveBuildEngineId,
  tarballName,
} from '../../../src/cli/build-linux';

const ENGINE_ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';

describe('linuxLayout', () => {
  const layout = linuxLayout('/tmp/out', 'My App');

  test('roots the AppDir at <out>/<Name>', () => {
    expect(layout.appDir).toBe('/tmp/out/My App');
  });

  test('derives a slug from the name', () => {
    expect(layout.slug).toBe('my-app');
  });

  test('places the binary in its own usr/lib/<slug> directory', () => {
    expect(layout.binPath).toBe('/tmp/out/My App/usr/lib/my-app/my-app');
  });

  test('puts only the launcher link in the shared usr/bin', () => {
    expect(layout.launcherPath).toBe('/tmp/out/My App/usr/bin/my-app');
  });

  test('places the desktop entry under usr/share/applications', () => {
    expect(layout.desktopPath).toBe('/tmp/out/My App/usr/share/applications/my-app.desktop');
  });

  test('places the icon under hicolor/512x512/apps', () => {
    expect(layout.iconPath).toBe('/tmp/out/My App/usr/share/icons/hicolor/512x512/apps/my-app.png');
  });

  test('bakes engine.id beside the binary', () => {
    expect(layout.engineIdPath).toBe('/tmp/out/My App/usr/lib/my-app/engine.id');
  });
});

describe('tarballName / debFileName', () => {
  test('tarball is <Name>-linux-x64.tar.gz', () => {
    expect(tarballName('My App', 'x64')).toBe('My App-linux-x64.tar.gz');
    expect(tarballName('My App', 'arm64')).toBe('My App-linux-arm64.tar.gz');
  });

  test('deb is <slug>_<version>_amd64.deb', () => {
    expect(debFileName('My App', '1.2.3', 'x64')).toBe('my-app_1.2.3_amd64.deb');
    expect(debFileName('My App', '1.2.3', 'arm64')).toBe('my-app_1.2.3_arm64.deb');
  });

  test('deb names a prerelease with the Debian tilde', () => {
    expect(debFileName('My App', '1.0.0-beta.1', 'x64')).toBe('my-app_1.0.0~beta.1_amd64.deb');
  });
});

describe('buildDesktopEntry', () => {
  const text = buildDesktopEntry({
    name: 'My App',
    slug: 'my-app',
    comment: 'A test app',
  });

  test('starts with the [Desktop Entry] header', () => {
    expect(text.split('\n')[0]).toBe('[Desktop Entry]');
  });

  test('carries the required keys and values', () => {
    expect(text).toContain('Type=Application');
    expect(text).toContain('Name=My App');
    expect(text).toContain('Exec=my-app');
    expect(text).toContain('Icon=my-app');
    expect(text).toContain('Categories=Utility;');
    expect(text).toContain('Terminal=false');
    expect(text).toContain('Comment=A test app');
  });

  test('substitutes the slug into Exec and Icon', () => {
    const other = buildDesktopEntry({
      name: 'Other Thing',
      slug: 'other-thing',
      comment: 'x',
    });
    expect(other).toContain('Name=Other Thing');
    expect(other).toContain('Exec=other-thing');
    expect(other).toContain('Icon=other-thing');
  });

  test('ends with a trailing newline', () => {
    expect(text.endsWith('\n')).toBe(true);
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

describe('buildLinuxApp', () => {
  test('refuses a one-character package name before compiling', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bunmaska-deb-name-'));
    await expect(buildLinuxApp({ entry: 'missing.ts', name: 'X', out })).rejects.toThrow(
      /at least 2 characters/,
    );
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

describe('resolveBuildEngineId', () => {
  const linuxX64 = { os: 'linux', arch: 'x64' } as const;

  test('passes a full engine-id for the build target through', () => {
    expect(resolveBuildEngineId(ENGINE_ID, linuxX64)).toBe(ENGINE_ID);
  });

  test('maps absent / system to the system sentinel', () => {
    expect(resolveBuildEngineId(undefined, linuxX64)).toBe('system');
    expect(resolveBuildEngineId('system', linuxX64)).toBe('system');
  });

  test('downgrades a bare upstream version to system (catalog is a follow-up)', () => {
    expect(resolveBuildEngineId('2.52.4', linuxX64)).toBe('system');
  });

  test('downgrades an engine built for another OS or architecture to system', () => {
    expect(resolveBuildEngineId(ENGINE_ID, { os: 'windows', arch: 'x64' })).toBe('system');
    expect(resolveBuildEngineId(ENGINE_ID, { os: 'linux', arch: 'arm64' })).toBe('system');
  });
});
