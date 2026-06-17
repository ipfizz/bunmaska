import { describe, expect, test } from 'bun:test';
import {
  localeCountryCode,
  normalizeLocale,
  parsePreferredLanguages,
} from '../../../../src/main/api/app-locale';

describe('normalizeLocale', () => {
  test('converts POSIX underscores and strips an encoding suffix', () => {
    expect(normalizeLocale('en_US.UTF-8')).toBe('en-US');
    expect(normalizeLocale('de_DE')).toBe('de-DE');
  });

  test('passes a BCP-47 tag through unchanged', () => {
    expect(normalizeLocale('en-US')).toBe('en-US');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-Hans-CN');
  });

  test('treats the POSIX C/POSIX locale and empty input as no locale', () => {
    expect(normalizeLocale('C')).toBe('');
    expect(normalizeLocale('POSIX')).toBe('');
    expect(normalizeLocale('')).toBe('');
  });

  test('drops a modifier suffix (@euro)', () => {
    expect(normalizeLocale('fr_FR.UTF-8@euro')).toBe('fr-FR');
  });
});

describe('localeCountryCode', () => {
  test('extracts the region from a locale', () => {
    expect(localeCountryCode('en-US')).toBe('US');
    expect(localeCountryCode('zh-Hans-CN')).toBe('CN');
  });

  test('returns empty when the locale carries no region', () => {
    expect(localeCountryCode('fr')).toBe('');
  });

  test('returns empty on an unparseable locale', () => {
    expect(localeCountryCode('!!!')).toBe('');
  });
});

describe('parsePreferredLanguages', () => {
  test('parses a colon-separated $LANGUAGE list, normalizing each', () => {
    expect(parsePreferredLanguages({ LANGUAGE: 'en_US:fr_FR' })).toEqual(['en-US', 'fr-FR']);
  });

  test('$LANGUAGE takes precedence over $LANG', () => {
    expect(parsePreferredLanguages({ LANGUAGE: 'de_DE', LANG: 'en_US.UTF-8' })).toEqual(['de-DE']);
  });

  test('falls back to $LANG when $LANGUAGE is absent', () => {
    expect(parsePreferredLanguages({ LANG: 'de_DE.UTF-8' })).toEqual(['de-DE']);
  });

  test('returns an empty list when no language env vars are set', () => {
    expect(parsePreferredLanguages({})).toEqual([]);
  });

  test('filters out C/POSIX/empty entries', () => {
    expect(parsePreferredLanguages({ LANGUAGE: 'C:en_US:POSIX:' })).toEqual(['en-US']);
  });
});
