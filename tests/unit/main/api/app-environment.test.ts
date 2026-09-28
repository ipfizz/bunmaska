import { describe, expect, test } from 'bun:test';
import {
  type AppEnvironment,
  buildAppEnvironment,
  defaultAppEnvironment,
  type EnvironmentDeps,
} from '../../../../src/main/api/app-environment';

/** Normalize host separators to POSIX so path comparisons match on any host. */
const slash = (s: string): string => s.replaceAll('\\', '/');

const deps = (overrides: Partial<EnvironmentDeps> = {}): EnvironmentDeps => ({
  platform: 'macos',
  home: '/Users/ada',
  temp: '/tmp',
  execPath: '/opt/homebrew/bin/bun',
  mainScript: '/proj/src/main.ts',
  cwd: '/proj',
  env: {},
  locale: 'en-US',
  readFile: (path) =>
    slash(path) === '/proj/package.json'
      ? JSON.stringify({ name: 'demo', version: '4.2.0' })
      : undefined,
  exit: () => undefined,
  relaunch: () => undefined,
  ...overrides,
});

const build = (overrides: Partial<EnvironmentDeps> = {}): AppEnvironment =>
  buildAppEnvironment(deps(overrides));

describe('buildAppEnvironment — manifest & appPath', () => {
  test('finds the manifest by walking up from the main script dir', () => {
    const env = build();
    expect(env.manifest?.name).toBe('demo');
    expect(env.manifest?.version).toBe('4.2.0');
    expect(slash(env.appPath)).toBe('/proj');
  });

  test('falls back to cwd as appPath when no manifest is found', () => {
    const env = build({ readFile: () => undefined });
    expect(env.manifest).toBeUndefined();
    expect(env.appPath).toBe('/proj');
  });

  test('uses cwd as the search root when there is no main script', () => {
    const env = build({
      mainScript: '',
      readFile: (p) => (slash(p) === '/proj/package.json' ? '{}' : undefined),
    });
    expect(slash(env.appPath)).toBe('/proj');
  });
});

describe('buildAppEnvironment - compiled binary', () => {
  const exeDir = '/Applications/Demo.app/Contents/MacOS';
  const compiled = (files: Record<string, string>): AppEnvironment =>
    build({
      execPath: `${exeDir}/Demo`,
      mainScript: '/$bunfs/root/Demo',
      cwd: '/',
      readFile: (path) => files[slash(path)],
    });

  test('reads the package.json beside the executable', () => {
    const env = compiled({
      [`${exeDir}/package.json`]: JSON.stringify({ productName: 'Demo', version: '1.2.0' }),
    });
    expect(env.manifest?.productName).toBe('Demo');
    expect(env.manifest?.version).toBe('1.2.0');
  });

  test('uses the executable directory as appPath', () => {
    expect(slash(compiled({}).appPath)).toBe(exeDir);
  });

  test('never adopts a package.json above the executable directory', () => {
    const env = compiled({ '/Applications/package.json': JSON.stringify({ version: '9.9.9' }) });
    expect(env.manifest).toBeUndefined();
  });
});

describe('buildAppEnvironment — locale & languages', () => {
  test('normalizes the raw locale', () => {
    expect(build({ locale: 'en_US.UTF-8' }).locale).toBe('en-US');
  });

  test('derives preferred languages from the Linux environment', () => {
    const env = build({ platform: 'linux', env: { LANGUAGE: 'fr_FR:en_US' } });
    expect(env.preferredLanguages).toEqual(['fr-FR', 'en-US']);
  });

  test('ignores LANG off Linux, where the system locale is authoritative', () => {
    const env = build({ platform: 'macos', locale: 'fr-FR', env: { LANG: 'en_US.UTF-8' } });
    expect(env.preferredLanguages).toEqual(['fr-FR']);
  });

  test('falls back to the normalized locale when no language env is set', () => {
    expect(build({ locale: 'de-DE', env: {} }).preferredLanguages).toEqual(['de-DE']);
  });

  test('yields no languages when neither env nor locale is usable', () => {
    expect(build({ locale: 'C', env: {} }).preferredLanguages).toEqual([]);
  });
});

describe('buildAppEnvironment — isPackaged', () => {
  test('is false when launched via the bun dev runner', () => {
    expect(build({ execPath: '/opt/homebrew/bin/bun' }).isPackaged).toBe(false);
  });

  test('is false under bun.exe on Windows', () => {
    const env = build({
      execPath: 'C:\\Users\\ada\\.bun\\bin\\bun.exe',
      mainScript: 'C:\\proj\\src\\main.ts',
    });
    expect(env.isPackaged).toBe(false);
  });

  test('is true for a compiled binary', () => {
    const env = build({ execPath: '/opt/demo/demo', mainScript: '/$bunfs/root/demo' });
    expect(env.isPackaged).toBe(true);
  });

  test('is true for a compiled Windows binary', () => {
    const env = build({ execPath: 'C:\\Demo\\demo.exe', mainScript: 'B:\\~BUN\\root\\demo.exe' });
    expect(env.isPackaged).toBe(true);
  });
});

describe('buildAppEnvironment — passthrough', () => {
  test('carries home/temp/execPath/env/exit through', () => {
    let exited = -1;
    const env = build({
      exit: (code) => {
        exited = code;
      },
    });
    expect(env.home).toBe('/Users/ada');
    expect(env.temp).toBe('/tmp');
    env.exit(3);
    expect(exited).toBe(3);
  });

  test('carries the relaunch hook through', () => {
    const calls: Array<[string, string[]]> = [];
    const env = build({
      relaunch: (execPath, args) => {
        calls.push([execPath, args]);
      },
    });
    env.relaunch('/bin/app', ['--flag']);
    expect(calls).toEqual([['/bin/app', ['--flag']]]);
  });
});

describe('defaultAppEnvironment - relaunch', () => {
  test('spawns ahead of exit listeners registered earlier', () => {
    const earlier = (): void => undefined;
    process.on('exit', earlier);
    const before = new Set(process.listeners('exit'));
    defaultAppEnvironment().relaunch('/bin/true', []);
    const added = process.listeners('exit').filter((listener) => !before.has(listener));
    try {
      expect(added).toHaveLength(1);
      expect(process.listeners('exit')[0]).toBe(added[0]);
    } finally {
      for (const listener of [earlier, ...added]) {
        process.removeListener('exit', listener);
      }
    }
  });
});
