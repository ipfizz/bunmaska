// Single source of truth for site-wide constants.

import pkg from '../../package.json';

// The framework's package.json is the only place the version lives.
export const VERSION: string = pkg.version;
export const GITHUB = 'https://github.com/ipfizz/bunmaska';
export const NPM = 'https://www.npmjs.com/package/bunmaska';
