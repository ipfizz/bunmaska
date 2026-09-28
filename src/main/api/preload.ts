// Classic-script injection: ESM preloads are bundled to an IIFE (D046).
import { resolve } from 'node:path';
import { InvalidArgumentError } from '../../common/errors';
import {
  defaultPreloadBundler,
  type PreloadBundler,
  readPreloadSource,
  usesModuleSyntax,
} from '../../common/preload-bundle';

/** The classic-script source for `webPreferences.preload`, or `undefined` when unset. */
export const loadPreloadScript = (
  preload: string | undefined,
  bundler: PreloadBundler = defaultPreloadBundler,
): string | undefined => {
  if (preload === undefined) {
    return undefined;
  }
  const absolutePath = resolve(preload);
  const source = readPreloadSource(absolutePath);
  if (!usesModuleSyntax(source) && !/\.[cm]?tsx?$/i.test(absolutePath)) {
    return source;
  }
  if (!bundler.available) {
    throw new InvalidArgumentError(
      `webPreferences.preload at ${absolutePath} uses TypeScript or 'import'/'export', which a preload ` +
        `cannot run un-bundled (it is injected as a classic script). Run it via 'bunmaska dev' ` +
        `or ship it with 'bunmaska build' (both bundle the preload), or keep the preload plain JavaScript.`,
    );
  }
  return bundler.bundle(absolutePath);
};
