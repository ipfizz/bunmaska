import pkg from '../../package.json';

/**
 * Current Bunmaska version, sourced from `package.json` at build time.
 * Always equal to `pkg.version`; the test suite enforces this.
 */
export const BUNMASKA_VERSION: string = pkg.version;
