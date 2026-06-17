import { describe, expect, test } from 'bun:test';
import {
  type AppEnvironment,
  buildAppEnvironment,
  type EnvironmentDeps,
} from '../../../../src/main/api/app-environment';

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
    path === '/proj/package.json' ? JSON.stringify({ name: 'demo', version: '4.2.0' }) : undefined,
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
    expect(env.appPath).toBe('/proj');
  });

  test('falls back to cwd as appPath when no manifest is found', () => {
    const env = build({ readFile: () => undefined });
    expect(env.manifest).toBeUndefined();
    expect(env.appPath).toBe('/proj');
  });

  test('uses cwd as the search root when there is no main script', () => {
    const env = build({
      mainScript: '',
      readFile: (p) => (p === '/proj/package.json' ? '{}' : undefined),
    });
    expect(env.appPath).toBe('/proj');
  });
});

describe('buildAppEnvironment — locale & languages', () => {
  test('normalizes the raw locale', () => {
    expect(build({ locale: 'en_US.UTF-8' }).locale).toBe('en-US');
  });

  test('derives preferred languages from the environment', () => {
    expect(build({ env: { LANGUAGE: 'fr_FR:en_US' } }).preferredLanguages).toEqual([
      'fr-FR',
      'en-US',
    ]);
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

  test('is false when launched via node', () => {
    expect(build({ execPath: '/usr/local/bin/node' }).isPackaged).toBe(false);
  });

  test('is true inside a packaged macOS .app bundle', () => {
    expect(build({ execPath: '/Applications/Demo.app/Contents/MacOS/Demo' }).isPackaged).toBe(true);
  });

  test('is true for a compiled standalone binary', () => {
    expect(build({ execPath: '/opt/demo/demo' }).isPackaged).toBe(true);
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
