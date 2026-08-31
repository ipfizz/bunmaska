/**
 * The renderer build Bunmaska owns (`config.renderer`). One recipe, deliberately:
 * a classic IIFE bundle, because `loadFile` serves `file://` where an ES module
 * fails the CORS null-origin check, built with `NODE_ENV=development` because
 * Bun's bundler emits `jsxDEV` regardless of tsconfig and the production React
 * runtime stubs it out. See .admin/RENDERER-BUILD.md for the derivation.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { BunmaskaRendererConfig } from '../common/config-schema';
import { rendererOutDir } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';

/** What one renderer build produced. */
export type RendererBuildResult = {
  /** Absolute path of the output directory. */
  readonly outDir: string;
  /** Output file names written into `outDir` (bundle first, then copies). */
  readonly written: readonly string[];
};

/** The bundler seam: builds `entry` into `outDir`, returns written file names. */
export type RendererBundler = (entry: string, outDir: string) => Promise<readonly string[]>;

const defaultBundler: RendererBundler = async (entry, outDir) => {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: 'browser',
    format: 'iife',
    // Dev React: Bun transpiles JSX to jsxDEV; the prod runtime stubs it out.
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    naming: '[dir]/[name].[ext]',
  });
  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('\n');
    throw new InvalidArgumentError(`renderer build failed for ${entry}:\n${messages}`);
  }
  return result.outputs.map((artifact) => basename(artifact.path));
};

/**
 * Build the configured renderer into its output directory: bundle the entry,
 * then copy the static files (`copy`) in verbatim. Paths resolve against
 * `projectDir`.
 */
export const buildRenderer = async (
  projectDir: string,
  renderer: BunmaskaRendererConfig,
  bundler: RendererBundler = defaultBundler,
): Promise<RendererBuildResult> => {
  const entry = resolve(projectDir, renderer.entry);
  if (!existsSync(entry)) {
    throw new InvalidArgumentError(`renderer.entry not found: ${entry}`);
  }
  const outDir = resolve(projectDir, rendererOutDir(renderer));
  mkdirSync(outDir, { recursive: true });
  const written = [...(await bundler(entry, outDir))];
  for (const relPath of renderer.copy ?? []) {
    const from = resolve(projectDir, relPath);
    if (!existsSync(from)) {
      throw new InvalidArgumentError(`renderer.copy source not found: ${from}`);
    }
    const name = basename(from);
    cpSync(from, join(outDir, name), { recursive: true });
    written.push(name);
  }
  return { outDir, written };
};
