/** POSIX placeholder locales that carry no real language information. */
const POSIX_PLACEHOLDERS: ReadonlySet<string> = new Set(['C', 'POSIX']);

/**
 * `en_US.UTF-8` → `en-US`. Returns `''` for the POSIX `C`/`POSIX` locales and
 * for empty input.
 */
export const normalizeLocale = (raw: string): string => {
  const base = raw.split('.')[0]?.split('@')[0] ?? '';
  if (base.length === 0 || POSIX_PLACEHOLDERS.has(base)) {
    return '';
  }
  return base.replace(/_/g, '-');
};

/** `en-US` → `US`; `''` when the locale has no region or cannot be parsed. */
export const localeCountryCode = (locale: string): string => {
  try {
    return new Intl.Locale(locale).region ?? '';
  } catch {
    return '';
  }
};

/**
 * Most-preferred first, from the colon-separated `$LANGUAGE` list, falling back
 * to `$LANG`. POSIX placeholders and blanks are dropped.
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
