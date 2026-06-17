import { describe, expect, test } from 'bun:test';
import {
  buildControlFile,
  buildDesktopEntry,
  debFileName,
  DEFAULT_LINUX_DEPENDS,
  linuxLayout,
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

  test('places the binary at usr/bin/<slug>', () => {
    expect(layout.binPath).toBe('/tmp/out/My App/usr/bin/my-app');
  });

  test('places the desktop entry under usr/share/applications', () => {
    expect(layout.desktopPath).toBe('/tmp/out/My App/usr/share/applications/my-app.desktop');
  });

  test('places the icon under hicolor/512x512/apps', () => {
    expect(layout.iconPath).toBe('/tmp/out/My App/usr/share/icons/hicolor/512x512/apps/my-app.png');
  });

  test('bakes engine.id under usr/share/<slug>', () => {
    expect(layout.engineIdPath).toBe('/tmp/out/My App/usr/share/my-app/engine.id');
  });
});

describe('tarballName / debFileName', () => {
  test('tarball is <Name>-linux-x64.tar.gz', () => {
    expect(tarballName('My App')).toBe('My App-linux-x64.tar.gz');
  });

  test('deb is <slug>_<version>_amd64.deb', () => {
    expect(debFileName('My App', '1.2.3')).toBe('my-app_1.2.3_amd64.deb');
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

  test('omits the Depends field entirely when deps are empty (embedded engine)', () => {
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

describe('resolveBuildEngineId', () => {
  test('passes a full engine-id through', () => {
    expect(resolveBuildEngineId(ENGINE_ID)).toBe(ENGINE_ID);
  });

  test('maps absent / system to the system sentinel', () => {
    expect(resolveBuildEngineId(undefined)).toBe('system');
    expect(resolveBuildEngineId('system')).toBe('system');
  });

  test('downgrades a bare upstream version to system (catalog is a follow-up)', () => {
    expect(resolveBuildEngineId('2.52.4')).toBe('system');
  });
});
