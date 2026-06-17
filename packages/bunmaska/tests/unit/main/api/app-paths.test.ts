import { describe, expect, test } from 'bun:test';
import { InvalidArgumentError } from '../../../../src/common/errors';
import { type PathEnvironment, resolveAppPath } from '../../../../src/main/api/app-paths';

const macEnv = (overrides: Partial<PathEnvironment> = {}): PathEnvironment => ({
  platform: 'macos',
  home: '/Users/ada',
  temp: '/var/folders/tmp',
  appName: 'MyApp',
  execPath: '/Applications/MyApp.app/Contents/MacOS/MyApp',
  appPath: '/Applications/MyApp.app/Contents/Resources/app',
  env: {},
  ...overrides,
});

const linuxEnv = (overrides: Partial<PathEnvironment> = {}): PathEnvironment => ({
  platform: 'linux',
  home: '/home/ada',
  temp: '/tmp',
  appName: 'MyApp',
  execPath: '/opt/myapp/myapp',
  appPath: '/opt/myapp/resources/app',
  env: {},
  ...overrides,
});

describe('resolveAppPath — cross-platform names', () => {
  test('home is the home dir on both platforms', () => {
    expect(resolveAppPath('home', macEnv())).toBe('/Users/ada');
    expect(resolveAppPath('home', linuxEnv())).toBe('/home/ada');
  });

  test('temp is the temp dir', () => {
    expect(resolveAppPath('temp', macEnv())).toBe('/var/folders/tmp');
    expect(resolveAppPath('temp', linuxEnv())).toBe('/tmp');
  });

  test('exe is the executable path', () => {
    expect(resolveAppPath('exe', macEnv())).toBe('/Applications/MyApp.app/Contents/MacOS/MyApp');
  });

  test('module is the app path', () => {
    expect(resolveAppPath('module', linuxEnv())).toBe('/opt/myapp/resources/app');
  });
});

describe('resolveAppPath — macOS conventions', () => {
  test('appData is ~/Library/Application Support', () => {
    expect(resolveAppPath('appData', macEnv())).toBe('/Users/ada/Library/Application Support');
  });

  test('userData is appData/<appName>', () => {
    expect(resolveAppPath('userData', macEnv())).toBe(
      '/Users/ada/Library/Application Support/MyApp',
    );
  });

  test('sessionData defaults to userData', () => {
    expect(resolveAppPath('sessionData', macEnv())).toBe(
      '/Users/ada/Library/Application Support/MyApp',
    );
  });

  test('logs is ~/Library/Logs/<appName>', () => {
    expect(resolveAppPath('logs', macEnv())).toBe('/Users/ada/Library/Logs/MyApp');
  });

  test('videos maps to ~/Movies (macOS quirk)', () => {
    expect(resolveAppPath('videos', macEnv())).toBe('/Users/ada/Movies');
  });

  test('desktop/documents/downloads/music/pictures use ~ subdirs', () => {
    const e = macEnv();
    expect(resolveAppPath('desktop', e)).toBe('/Users/ada/Desktop');
    expect(resolveAppPath('documents', e)).toBe('/Users/ada/Documents');
    expect(resolveAppPath('downloads', e)).toBe('/Users/ada/Downloads');
    expect(resolveAppPath('music', e)).toBe('/Users/ada/Music');
    expect(resolveAppPath('pictures', e)).toBe('/Users/ada/Pictures');
  });

  test('crashDumps is under userData', () => {
    expect(resolveAppPath('crashDumps', macEnv())).toBe(
      '/Users/ada/Library/Application Support/MyApp/Crashpad',
    );
  });
});

describe('resolveAppPath — Linux XDG conventions', () => {
  test('appData defaults to ~/.config', () => {
    expect(resolveAppPath('appData', linuxEnv())).toBe('/home/ada/.config');
  });

  test('appData honors $XDG_CONFIG_HOME', () => {
    expect(resolveAppPath('appData', linuxEnv({ env: { XDG_CONFIG_HOME: '/cfg' } }))).toBe('/cfg');
  });

  test('userData is appData/<appName>', () => {
    expect(resolveAppPath('userData', linuxEnv())).toBe('/home/ada/.config/MyApp');
  });

  test('logs is ~/.config/<appName>/logs', () => {
    expect(resolveAppPath('logs', linuxEnv())).toBe('/home/ada/.config/MyApp/logs');
  });

  test('downloads defaults to ~/Downloads', () => {
    expect(resolveAppPath('downloads', linuxEnv())).toBe('/home/ada/Downloads');
  });

  test('downloads honors $XDG_DOWNLOAD_DIR', () => {
    expect(resolveAppPath('downloads', linuxEnv({ env: { XDG_DOWNLOAD_DIR: '/dl' } }))).toBe('/dl');
  });

  test('videos honors $XDG_VIDEOS_DIR else ~/Videos', () => {
    expect(resolveAppPath('videos', linuxEnv())).toBe('/home/ada/Videos');
    expect(resolveAppPath('videos', linuxEnv({ env: { XDG_VIDEOS_DIR: '/vid' } }))).toBe('/vid');
  });
});

describe('resolveAppPath — errors', () => {
  test('throws InvalidArgumentError on an unknown name', () => {
    // @ts-expect-error — exercising the runtime guard with an invalid name
    expect(() => resolveAppPath('nope', macEnv())).toThrow(InvalidArgumentError);
  });
});
