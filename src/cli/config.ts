/**
 * Filesystem discovery + dynamic import of a project's `bunmaska.config.ts`. The
 * schema and validation live in {@link ../common/config-schema}.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CONFIG_FILE_NAMES, type BunmaskaConfig, validateConfig } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';

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
  const absolute = resolve(path);
  let module: Record<string, unknown>;
  try {
    module = (await import(absolute)) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A config importing `bunmaska/config` before `bun install` fails in Bun's
    // resolver; say what to do instead of dumping the stack.
    if (/Cannot find (module|package)/.test(message)) {
      throw new InvalidArgumentError(
        `${path}: could not import the config (${message.split('\n')[0]}). Run bun install in ${dirname(absolute)} first.`,
      );
    }
    throw error;
  }
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
