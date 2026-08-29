/**
 * Filesystem discovery + dynamic import of a project's `bunmaska.config.ts`. The
 * schema and validation live in {@link ../common/config-schema}.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { CONFIG_FILE_NAMES, type BunmaskaConfig, validateConfig } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';

export {
  CONFIG_FILE_NAMES,
  configChannel,
  defineConfig,
  type BunmaskaConfig,
  type BunmaskaUpdatesConfig,
  validateConfig,
} from '../common/config-schema';

/**
 * Absolute path of the project's config file, or `undefined`. The first name in
 * {@link CONFIG_FILE_NAMES} wins.
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
 * Accepts a `default` export or a named `config` export; throws
 * {@link InvalidArgumentError} if neither is present or the value is malformed.
 */
export const loadConfigFile = async (path: string): Promise<BunmaskaConfig> => {
  const absolute = isAbsolute(path) ? path : resolve(path);
  const module = (await import(absolute)) as Record<string, unknown>;
  const value = module['default'] ?? module['config'];
  if (value === undefined) {
    throw new InvalidArgumentError(`${path}: expected a default export (or a "config" export)`);
  }
  return validateConfig(value, path);
};

/**
 * Returns an empty config with `configPath: undefined` when the project has no
 * config file.
 */
export const loadConfig = async (
  cwd: string = process.cwd(),
): Promise<{ readonly config: BunmaskaConfig; readonly configPath: string | undefined }> => {
  const configPath = findConfigFile(cwd);
  if (configPath === undefined) {
    return { config: {}, configPath: undefined };
  }
  return { config: await loadConfigFile(configPath), configPath };
};
