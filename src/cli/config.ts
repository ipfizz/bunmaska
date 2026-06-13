/**
 * `sambar.config.ts` loader for the CLI.
 *
 * A Sambar project may drop a `sambar.config.ts` (or `.js`/`.mjs`) at its root
 * to declare the app's name, bundle id, entry, icon and update feed once,
 * instead of repeating `sambar build` flags. `sambar init`/`dev`/`build` all
 * read it. The pure schema + validation live in {@link ../common/config-schema}
 * (re-exported here); this module adds the filesystem discovery and dynamic
 * import.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { CONFIG_FILE_NAMES, type SambarConfig, validateConfig } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';

export {
  CONFIG_FILE_NAMES,
  configChannel,
  defineConfig,
  type SambarConfig,
  type SambarUpdatesConfig,
  validateConfig,
} from '../common/config-schema';

/**
 * Find the project's config file under `cwd`, or `undefined` if none exists.
 * Returns an absolute path. The first name in {@link CONFIG_FILE_NAMES} wins.
 */
export const findConfigFile = (cwd: string): string | undefined => {
  for (const fileName of CONFIG_FILE_NAMES) {
    const candidate = join(cwd, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

/**
 * Import and validate a single config file by path. Accepts a `default` export
 * or a named `config` export. Throws {@link InvalidArgumentError} if neither is
 * present or the value is malformed.
 */
export const loadConfigFile = async (path: string): Promise<SambarConfig> => {
  const absolute = isAbsolute(path) ? path : resolve(path);
  const module = (await import(absolute)) as Record<string, unknown>;
  const value = module['default'] ?? module['config'];
  if (value === undefined) {
    throw new InvalidArgumentError(`${path}: expected a default export (or a "config" export)`);
  }
  return validateConfig(value, path);
};

/**
 * Load the project config under `cwd`. Returns the (validated) config and the
 * file it came from, or an empty config with `configPath: undefined` when the
 * project has no config file.
 */
export const loadConfig = async (
  cwd: string = process.cwd(),
): Promise<{ readonly config: SambarConfig; readonly configPath: string | undefined }> => {
  const configPath = findConfigFile(cwd);
  if (configPath === undefined) {
    return { config: {}, configPath: undefined };
  }
  return { config: await loadConfigFile(configPath), configPath };
};
