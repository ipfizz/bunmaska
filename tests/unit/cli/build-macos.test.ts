import { describe, expect, test } from 'bun:test';
import {
  appBundleLayout,
  bundleIdSlug,
  buildInfoPlist,
  defaultBundleId,
} from '../../../src/cli/build-macos';

describe('bundleIdSlug', () => {
  test('lowercases and hyphenates', () => {
    expect(bundleIdSlug('My App')).toBe('my-app');
  });

  test('strips non-alphanumeric runs to single hyphens and trims edges', () => {
    expect(bundleIdSlug('  Hello!!World  ')).toBe('hello-world');
    expect(bundleIdSlug('a__b--c')).toBe('a-b-c');
  });

  test('falls back to app for an empty slug', () => {
    expect(bundleIdSlug('!!!')).toBe('app');
    expect(bundleIdSlug('')).toBe('app');
  });
});

describe('defaultBundleId', () => {
  test('namespaces the slug under com.sambar', () => {
    expect(defaultBundleId('My App')).toBe('com.sambar.my-app');
  });
});

describe('buildInfoPlist', () => {
  const plist = buildInfoPlist({
    name: 'My App',
    bundleId: 'com.example.app',
    version: '1.2.3',
  });

  test('is XML with a plist root and a dict', () => {
    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain('<!DOCTYPE plist');
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain('<dict>');
    expect(plist).toContain('</dict>');
    expect(plist.trimEnd().endsWith('</plist>')).toBe(true);
  });

  test('carries the required CFBundle keys', () => {
    for (const key of [
      'CFBundleName',
      'CFBundleDisplayName',
      'CFBundleIdentifier',
      'CFBundleExecutable',
      'CFBundlePackageType',
      'CFBundleInfoDictionaryVersion',
      'CFBundleShortVersionString',
      'CFBundleVersion',
      'LSMinimumSystemVersion',
      'NSHighResolutionCapable',
    ]) {
      expect(plist).toContain(`<key>${key}</key>`);
    }
  });

  test('substitutes the name, id, executable and version', () => {
    expect(plist).toContain('<key>CFBundleName</key>\n  <string>My App</string>');
    expect(plist).toContain('<key>CFBundleDisplayName</key>\n  <string>My App</string>');
    expect(plist).toContain('<key>CFBundleExecutable</key>\n  <string>My App</string>');
    expect(plist).toContain('<key>CFBundleIdentifier</key>\n  <string>com.example.app</string>');
    expect(plist).toContain('<key>CFBundleShortVersionString</key>\n  <string>1.2.3</string>');
    expect(plist).toContain('<key>CFBundleVersion</key>\n  <string>1.2.3</string>');
  });

  test('declares an APPL package type and the 6.0 dictionary version', () => {
    expect(plist).toContain('<key>CFBundlePackageType</key>\n  <string>APPL</string>');
    expect(plist).toContain('<key>CFBundleInfoDictionaryVersion</key>\n  <string>6.0</string>');
  });

  test('NSHighResolutionCapable is a true boolean', () => {
    expect(plist).toContain('<key>NSHighResolutionCapable</key>\n  <true/>');
  });

  test('omits the icon key when no icon file is given', () => {
    expect(plist).not.toContain('CFBundleIconFile');
  });

  test('includes the icon key when an icon file is given', () => {
    const withIcon = buildInfoPlist({
      name: 'My App',
      bundleId: 'com.example.app',
      version: '1.2.3',
      iconFile: 'My App.icns',
    });
    expect(withIcon).toContain('<key>CFBundleIconFile</key>\n  <string>My App.icns</string>');
  });

  test('escapes XML-special characters in the name', () => {
    const escaped = buildInfoPlist({
      name: 'A & B <C>',
      bundleId: 'com.example.app',
      version: '1.0.0',
    });
    expect(escaped).toContain('A &amp; B &lt;C&gt;');
    expect(escaped).not.toContain('A & B <C>');
  });
});

describe('appBundleLayout', () => {
  const layout = appBundleLayout('/tmp/out', 'My App');

  test('roots the bundle at <out>/<Name>.app', () => {
    expect(layout.appDir).toBe('/tmp/out/My App.app');
    expect(layout.contentsDir).toBe('/tmp/out/My App.app/Contents');
  });

  test('places the executable under Contents/MacOS/<Name>', () => {
    expect(layout.macosDir).toBe('/tmp/out/My App.app/Contents/MacOS');
    expect(layout.executablePath).toBe('/tmp/out/My App.app/Contents/MacOS/My App');
  });

  test('places Info.plist and Resources under Contents', () => {
    expect(layout.infoPlistPath).toBe('/tmp/out/My App.app/Contents/Info.plist');
    expect(layout.resourcesDir).toBe('/tmp/out/My App.app/Contents/Resources');
  });

  test('names the icon Resources/<Name>.icns', () => {
    expect(layout.iconPath).toBe('/tmp/out/My App.app/Contents/Resources/My App.icns');
    expect(layout.iconFileName).toBe('My App.icns');
  });
});
