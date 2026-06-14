import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunmaskaError } from '../../../src/common/errors';
import {
  configChannel,
  findConfigFile,
  loadConfig,
  loadConfigFile,
  validateConfig,
} from '../../../src/cli/config';

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-config-'));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('validateConfig', () => {
  test('accepts and copies known string fields', () => {
    const config = validateConfig({
      name: 'My App',
      id: 'com.example.app',
      entry: 'src/main.ts',
      icon: 'icon.png',
    });
    expect(config).toEqual({
      name: 'My App',
      id: 'com.example.app',
      entry: 'src/main.ts',
      icon: 'icon.png',
    });
  });

  test('accepts a nested updates object', () => {
    const config = validateConfig({ updates: { url: 'https://x/y', channel: 'canary' } });
    expect(config.updates).toEqual({ url: 'https://x/y', channel: 'canary' });
  });

  test('returns an empty config for {}', () => {
    expect(validateConfig({})).toEqual({});
  });

  test('rejects a non-object config', () => {
    expect(() => validateConfig(null)).toThrow(BunmaskaError);
    expect(() => validateConfig('nope')).toThrow(/must be an object/);
  });

  test('rejects a non-string field naming it', () => {
    expect(() => validateConfig({ name: 42 })).toThrow(/"name" must be a string/);
    expect(() => validateConfig({ updates: { url: 5 } })).toThrow(/"updates.url" must be a string/);
  });

  test('rejects a non-object updates', () => {
    expect(() => validateConfig({ updates: 'x' })).toThrow(/"updates" must be an object/);
  });
});

describe('configChannel', () => {
  test('defaults to stable', () => {
    expect(configChannel({})).toBe('stable');
  });

  test('uses the configured channel', () => {
    expect(configChannel({ updates: { channel: 'canary' } })).toBe('canary');
  });
});

describe('findConfigFile', () => {
  test('returns undefined when no config exists', () => {
    expect(findConfigFile(makeTmpDir())).toBeUndefined();
  });

  test('finds bunmaska.config.mjs', () => {
    const dir = makeTmpDir();
    const path = join(dir, 'bunmaska.config.mjs');
    writeFileSync(path, 'export default {}');
    expect(findConfigFile(dir)).toBe(path);
  });
});

describe('loadConfigFile / loadConfig', () => {
  test('imports a default export and validates it', async () => {
    const dir = makeTmpDir();
    const path = join(dir, 'bunmaska.config.mjs');
    writeFileSync(path, "export default { name: 'Fixture', entry: 'src/main.ts' }");
    expect(await loadConfigFile(path)).toEqual({ name: 'Fixture', entry: 'src/main.ts' });
  });

  test('imports a named "config" export when there is no default', async () => {
    const dir = makeTmpDir();
    const path = join(dir, 'bunmaska.config.mjs');
    writeFileSync(path, "export const config = { name: 'Named' }");
    expect(await loadConfigFile(path)).toEqual({ name: 'Named' });
  });

  test('throws when no usable export is present', async () => {
    const dir = makeTmpDir();
    const path = join(dir, 'bunmaska.config.mjs');
    writeFileSync(path, "export const other = { name: 'x' }");
    await expect(loadConfigFile(path)).rejects.toThrow(/expected a default export/);
  });

  test('loadConfig returns an empty config for a project with no config file', async () => {
    expect(await loadConfig(makeTmpDir())).toEqual({ config: {}, configPath: undefined });
  });

  test('loadConfig finds and loads the project config', async () => {
    const dir = makeTmpDir();
    const path = join(dir, 'bunmaska.config.mjs');
    writeFileSync(path, "export default { name: 'Loaded' }");
    expect(await loadConfig(dir)).toEqual({ config: { name: 'Loaded' }, configPath: path });
  });
});
