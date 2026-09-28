/** Finds and imports a project's bunmaska.config; the schema lives in common/config-schema. */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CONFIG_FILE_NAMES, type BunmaskaConfig, validateConfig } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';

/** The project's config file; the first existing name in {@link CONFIG_FILE_NAMES} wins. */
export const findConfigFile = (cwd: string): string | undefined => {
  for (const fileName of CONFIG_FILE_NAMES) {
    const candidate = join(cwd, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

/** Takes the `default` or a named `config` export; throws {@link InvalidArgumentError} if bad. */
export const loadConfigFile = async (path: string): Promise<BunmaskaConfig> => {
  const absolute = resolve(path);
  let module: Record<string, unknown>;
  try {
    module = (await import(absolute)) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // With no node_modules Bun auto-installs the import; with one that lacks bunmaska
    // the import fails here, so say what to do instead of dumping the stack.
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

/** An empty config and `configPath: undefined` when the project has no config file. */
export const loadConfig = async (
  cwd: string = process.cwd(),
): Promise<{ readonly config: BunmaskaConfig; readonly configPath: string | undefined }> => {
  const configPath = findConfigFile(cwd);
  if (configPath === undefined) {
    return { config: {}, configPath: undefined };
  }
  return { config: await loadConfigFile(configPath), configPath };
};
