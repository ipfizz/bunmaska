/**
 * Pure locale helpers backing `app.getLocale` / `getLocaleCountryCode` /
 * `getPreferredSystemLanguages`.
 *
 * The `app` layer reads the live locale from `Intl` and the language preference
 * from `process.env`; these helpers do the string normalization and parsing so
 * the logic is unit-tested without depending on the host's actual locale.
 */

/** POSIX placeholder locales that carry no real language information. */
const POSIX_PLACEHOLDERS: ReadonlySet<string> = new Set(['C', 'POSIX']);

/**
 * Normalize an OS locale string to a BCP-47 tag: `en_US.UTF-8` → `en-US`.
 * Strips the `.encoding` and `@modifier` suffixes and converts `_` to `-`.
 * Returns `''` for the POSIX `C`/`POSIX` locales and empty input.
 */
export const normalizeLocale = (raw: string): string => {
  const base = raw.split('.')[0]?.split('@')[0] ?? '';
  if (base.length === 0 || POSIX_PLACEHOLDERS.has(base)) {
    return '';
  }
  return base.replace(/_/g, '-');
};

/**
 * The two-letter region/country code of a BCP-47 locale (`en-US` → `US`), or
 * `''` when the locale has no region or cannot be parsed.
 */
export const localeCountryCode = (locale: string): string => {
  try {
    return new Intl.Locale(locale).region ?? '';
  } catch {
    return '';
  }
};

/**
 * The user's preferred languages from the environment, most-preferred first.
 * Prefers the colon-separated `$LANGUAGE` list, falling back to `$LANG`; each
 * entry is normalized and POSIX placeholders / blanks are dropped.
 */
export const parsePreferredLanguages = (
  env: Readonly<Record<string, string | undefined>>,
): string[] => {
  const language = env['LANGUAGE'];
  if (language !== undefined && language.length > 0) {
    return language
      .split(':')
      .map(normalizeLocale)
      .filter((tag) => tag.length > 0);
  }
  const lang = env['LANG'];
  if (lang !== undefined) {
    const normalized = normalizeLocale(lang);
    if (normalized.length > 0) {
      return [normalized];
    }
  }
  return [];
};
