/** Bundles module-syntax preloads to a classic IIFE for the runtime and `bunmaska build` (D046). */

import { readFileSync } from 'node:fs';
import { InvalidArgumentError } from './errors';

/** Read a preload file as UTF-8, naming the path on failure. */
export const readPreloadSource = (absolutePath: string): string => {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (cause) {
    throw new InvalidArgumentError(`failed to read webPreferences.preload at ${absolutePath}`, {
      cause,
    });
  }
};

/**
 * Whether `source` uses top-level ES-module syntax a classic script cannot run. It must
 * never miss a real `import`; a false positive costs a redundant bundle pass, except that
 * Bun's IIFE never runs a CommonJS (`require`/`module.exports`) entry's body.
 */
export const usesModuleSyntax = (source: string): boolean =>
  /^[ \t]*(?:import|export)\b/m.test(source);

/** A seam that turns a preload file into a single classic-script string. */
export type PreloadBundler = {
  /** Whether a bundler can run in this process (false inside a compiled app). */
  readonly available: boolean;
  /** Bundle the file at `absolutePath` into a classic IIFE. Throws on a real error. */
  readonly bundle: (absolutePath: string) => string;
};

/** Whether `execPath` is the Bun CLI; a compiled app's binary (even one named `bun-*`) is not. */
export const isBunCli = (execPath: string): boolean =>
  /(?:^|[\\/])bunx?(?:-debug|-profile)?(?:\.exe)?$/i.test(execPath);

/** The Bun CLI, where the bundler is reachable; a compiled app must never re-spawn itself as one. */
const bunCliPath = (): string | undefined =>
  isBunCli(process.execPath) ? process.execPath : undefined;

/** Production bundler: shells out to Bun's bundler. Available only under the Bun CLI. */
export const defaultPreloadBundler: PreloadBundler = {
  get available(): boolean {
    return bunCliPath() !== undefined;
  },
  bundle: (absolutePath: string): string => {
    const exe = bunCliPath();
    if (exe === undefined) {
      return readPreloadSource(absolutePath);
    }
    const result = Bun.spawnSync(
      [exe, 'build', absolutePath, '--target=browser', '--format=iife'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    if (!result.success) {
      const detail = result.stderr.toString().trim();
      throw new InvalidArgumentError(
        `failed to bundle webPreferences.preload at ${absolutePath}${detail ? `\n${detail}` : ''}`,
      );
    }
    const out = result.stdout.toString();
    return out.trim().length > 0 ? out : readPreloadSource(absolutePath);
  },
};
