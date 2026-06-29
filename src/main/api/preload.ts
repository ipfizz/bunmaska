/**
 * Loading a `webPreferences.preload` into the classic script that the platform
 * backends inject at document-start.
 *
 * A preload runs as a CLASSIC script, so a top-level `import` would throw and
 * silently kill it (and any `window.api` it exposes). Plain preloads are returned
 * verbatim; a preload that uses `import`/`export` is bundled into a self-contained
 * IIFE when a bundler is available, and otherwise raises a clear error. See
 * {@link ../../common/preload-bundle}.
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
 *
 * Plain preloads are returned verbatim; a preload that uses `import`/`export` is
 * bundled into a self-contained IIFE when a bundler is available, and otherwise
 * raises a clear error (rather than silently breaking `window.api`).
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
