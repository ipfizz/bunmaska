import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_APP_NAME,
  DEFAULT_APP_VERSION,
  findManifest,
  type ManifestReader,
  resolveAppName,
  resolveAppVersion,
} from '../../../../src/main/api/app-metadata';

/** Normalize host separators to POSIX so the map keys match on any host. */
const slash = (s: string): string => s.replaceAll('\\', '/');

/** Build a reader backed by a fixed path→contents map (keyed POSIX-style). */
const readerFrom = (files: Record<string, string>): ManifestReader => {
  return (path) => {
    const key = slash(path);
    return key in files ? files[key] : undefined;
  };
};

describe('findManifest', () => {
  test('returns the nearest package.json walking up from the start dir', () => {
    const read = readerFrom({
      '/app/src/package.json': JSON.stringify({ name: 'inner', version: '2.0.0' }),
      '/app/package.json': JSON.stringify({ name: 'outer', version: '1.0.0' }),
    });
    const found = findManifest('/app/src/main', read);
    expect(slash(found?.dir ?? '')).toBe('/app/src');
    expect(found?.manifest.name).toBe('inner');
  });

  test('walks up to a parent when the start dir has no package.json', () => {
    const read = readerFrom({
      '/app/package.json': JSON.stringify({ name: 'outer', version: '1.0.0' }),
    });
    const found = findManifest('/app/src/deeply/nested', read);
    expect(slash(found?.dir ?? '')).toBe('/app');
    expect(found?.manifest.name).toBe('outer');
  });

  test('returns undefined when no package.json exists up to the root', () => {
    expect(findManifest('/app/src', readerFrom({}))).toBeUndefined();
  });

  test('skips a malformed package.json and continues upward', () => {
    const read = readerFrom({
      '/app/src/package.json': '{ this is not json',
      '/app/package.json': JSON.stringify({ name: 'outer', version: '1.0.0' }),
    });
    const found = findManifest('/app/src', read);
    expect(slash(found?.dir ?? '')).toBe('/app');
    expect(found?.manifest.name).toBe('outer');
  });
});

describe('resolveAppName', () => {
  test('prefers an explicit override (setName) above all', () => {
    expect(resolveAppName({ productName: 'Prod', name: 'pkg' }, 'Override')).toBe('Override');
  });

  test('prefers productName over name', () => {
    expect(resolveAppName({ productName: 'Prod', name: 'pkg' })).toBe('Prod');
  });

  test('falls back to name when productName is absent', () => {
    expect(resolveAppName({ name: 'pkg' })).toBe('pkg');
  });

  test('falls back to the default when no manifest is present', () => {
    expect(resolveAppName(undefined)).toBe(DEFAULT_APP_NAME);
  });

  test('ignores a blank override', () => {
    expect(resolveAppName({ name: 'pkg' }, '')).toBe('pkg');
  });
});

describe('resolveAppVersion', () => {
  test('returns the manifest version', () => {
    expect(resolveAppVersion({ version: '3.1.4' })).toBe('3.1.4');
  });

  test('falls back to the default when absent', () => {
    expect(resolveAppVersion(undefined)).toBe(DEFAULT_APP_VERSION);
    expect(resolveAppVersion({ name: 'pkg' })).toBe(DEFAULT_APP_VERSION);
  });
});
