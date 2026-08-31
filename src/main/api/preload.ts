/**
 * A preload runs as a CLASSIC script, so a top-level `import` would throw and
 * silently kill it (and any `window.api` it exposes) — module-syntax preloads
 * are bundled into an IIFE instead.
 */

import { resolve } from 'node:path';
import { InvalidArgumentError } from '../../common/errors';
import {
  defaultPreloadBundler,
  type PreloadBundler,
  readPreloadSource,
  usesModuleSyntax,
} from '../../common/preload-bundle';

/**
 * Resolve and load a `webPreferences.preload` into the classic-script string
 * injected at document-start. Returns `undefined` when no preload is set.
 */
export const loadPreloadScript = (
  preload: string | undefined,
  bundler: PreloadBundler = defaultPreloadBundler,
): string | undefined => {
  if (preload === undefined) {
    return undefined;
  }
  const absolutePath = resolve(preload);
  const source = readPreloadSource(absolutePath);
  if (!usesModuleSyntax(source)) {
    return source;
  }
  if (!bundler.available) {
    throw new InvalidArgumentError(
      `webPreferences.preload at ${absolutePath} uses 'import'/'export', which a preload ` +
        `cannot run un-bundled (it is injected as a classic script). Run it via 'bunmaska dev' ` +
        `or ship it with 'bunmaska build' (both bundle the preload), or keep the preload plain JavaScript.`,
    );
  }
  return bundler.bundle(absolutePath);
};
