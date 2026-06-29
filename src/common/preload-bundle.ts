/**
 * Shared preload bundling — used by the runtime ({@link ../main/api/preload}) and
 * by `bunmaska build` ({@link ../cli/app-assets}).
 *
 * A preload is injected as a CLASSIC script (a `WKUserScript` and its WebKitGTK /
 * WinCairo equivalents have no module mode), so a top-level `import` throws a
 * `SyntaxError` that aborts the whole preload — silently taking `window.api` with
 * it. The fix is to bundle the preload into a single self-contained IIFE, inlining
 * its imports, before it is injected or shipped.
 */

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
 * Whether `source` uses top-level ES-module syntax that a classic script cannot
 * run (a leading `import`/`export` statement). Pure. Deliberately conservative: it
 * must never miss a real top-level `import` (the breaking case); an occasional
 * false positive only costs a redundant bundle pass.
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

/**
 * The Bun executable when we are running under the Bun CLI (`bunmaska dev` /
 * `bunmaska build` / `bun run`), where the bundler is reachable; `undefined`
 * inside a compiled app (whose `process.execPath` is the app binary, which must
 * never be re-spawned as a bundler).
 */
const bunCliPath = (): string | undefined => {
  const exe = process.execPath;
  return /(?:^|[\\/])bun(?:-[^\\/]*)?(?:\.exe)?$/i.test(exe) ? exe : undefined;
};

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
