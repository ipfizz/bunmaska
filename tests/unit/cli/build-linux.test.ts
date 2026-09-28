import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildLinuxApp,
  buildDesktopEntry,
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

describe('tarballName', () => {
  test('tarball is <Name>-linux-x64.tar.gz', () => {
    expect(tarballName('My App', 'x64')).toBe('My App-linux-x64.tar.gz');
    expect(tarballName('My App', 'arm64')).toBe('My App-linux-arm64.tar.gz');
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

describe('buildLinuxApp', () => {
  test('refuses a one-character package name before compiling', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bunmaska-deb-name-'));
    await expect(buildLinuxApp({ entry: 'missing.ts', name: 'X', out })).rejects.toThrow(
      /at least 2 characters/,
    );
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
