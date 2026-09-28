// A classic IIFE: `loadFile` serves `file://`, where an ES module fails the CORS null-origin check.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { BunmaskaRendererConfig } from '../common/config-schema';
import { rendererOutDir } from '../common/config-schema';
import { InvalidArgumentError } from '../common/errors';

export type RendererBuildResult = {
  readonly outDir: string;
  /** File names written into `outDir`: the bundle first, then the copies. */
  readonly written: readonly string[];
};

export type RendererMode = 'development' | 'production';

export type RendererBundler = (
  entry: string,
  outDir: string,
  mode: RendererMode,
) => Promise<readonly string[]>;

const defaultBundler: RendererBundler = async (entry, outDir, mode) => {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: 'browser',
    format: 'iife',
    // The define picks the JSX runtime too: development emits jsxDEV, production jsx.
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    naming: '[dir]/[name].[ext]',
    throw: false,
  });
  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('\n');
    throw new InvalidArgumentError(`renderer build failed for ${entry}:\n${messages}`);
  }
  return result.outputs.map((artifact) => basename(artifact.path));
};

/** Bundle the entry, then copy `copy` in verbatim; paths resolve against `projectDir`. */
export const buildRenderer = async (
  projectDir: string,
  renderer: BunmaskaRendererConfig,
  mode: RendererMode = 'production',
  bundler: RendererBundler = defaultBundler,
): Promise<RendererBuildResult> => {
  const entry = resolve(projectDir, renderer.entry);
  if (!existsSync(entry)) {
    throw new InvalidArgumentError(`renderer.entry not found: ${entry}`);
  }
  const outDir = resolve(projectDir, rendererOutDir(renderer));
  mkdirSync(outDir, { recursive: true });
  const written = [...(await bundler(entry, outDir, mode))];
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
