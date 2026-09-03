// Single source of truth for site-wide constants.

import pkg from '../../package.json';

// The framework's package.json is the only place the version lives.
export const VERSION: string = pkg.version;
export const GITHUB = 'https://github.com/ipfizz/bunmaska';
export const NPM = 'https://www.npmjs.com/package/bunmaska';

/**
 * GitHub star count, fetched once at build time (this module evaluates once
 * per build). `null` when the API is unreachable, so the CTA degrades to a
 * plain "Star on GitHub" rather than a fake number.
 */
export const STARS: number | null = await (async () => {
  try {
    const token = process.env['GITHUB_TOKEN'];
    const res = await fetch('https://api.github.com/repos/ipfizz/bunmaska', {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === 'number' ? data.stargazers_count : null;
  } catch {
    return null;
  }
})();

/** "1.2k" style, only worth showing once there is something to show. */
export const starsLabel = (n: number | null): string | null =>
  n === null || n < 100
    ? null
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
      : String(n);
