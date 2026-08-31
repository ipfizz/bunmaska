/**
 * Windows ships no system WebKit, so at launch Bunmaska `dlopen`s a WinCairo
 * `WebKit2.dll`. With `--embed-engine` that engine's whole directory is copied
 * into the bundle's `webkit/` folder and the `.exe` runs with NO environment
 * variables; without it the launch relies on the engine store (the baked
 * `engine.id`) or `BUNMASKA_WEBKIT_PATH`.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNMASKA_VERSION } from '../common/version';
import { bundlePreloadAssets, copyAppAssets } from './app-assets';
import { bundleIdSlug } from './build-macos';
import { buildZipArchive, type ZipEntry } from './zip';

/**
 * The bundle subdirectory an embedded WinCairo engine is copied into. The runtime
 * looks for `<exeDir>/webkit/WebKit2.dll` (see `webkit2-ffi.ts`'s `bundledEngineDir`,
 * which carries the matching constant) — keep the two in sync.
 */
export const BUNDLED_ENGINE_DIRNAME = 'webkit';

export type WindowsLayout = {
  readonly appDir: string;
  readonly slug: string;
  readonly exeName: string;
  readonly exePath: string;
  /** The baked engine-id, read at launch (resolves the WinCairo engine to load). */
  readonly engineIdPath: string;
};

export const windowsLayout = (out: string, name: string): WindowsLayout => {
  const appDir = join(out, name);
  const exeName = `${name}.exe`;
  return {
    appDir,
    slug: bundleIdSlug(name),
    exeName,
    exePath: join(appDir, exeName),
    engineIdPath: join(appDir, 'engine.id'),
  };
};

export const zipFileName = (name: string): string => `${name}-windows-x64.zip`;

/**
 * A Windows PE VERSIONINFO resource (`--windows-version`) accepts only a numeric
 * `major.minor.patch`, so `+build` and `-prerelease` are dropped, short segments
 * zero-padded, and a non-numeric segment becomes `0`. `0.1.0-alpha.2` -> `0.1.0`.
 */
export const numericVersion = (version: string): string => {
  const core = (version.split('+', 1)[0] ?? '').split('-', 1)[0] ?? '';
  const parts = core
    .split('.')
    .slice(0, 3)
    .map((segment) => {
      const value = Number.parseInt(segment, 10);
      return Number.isNaN(value) ? '0' : String(value);
    });
  while (parts.length < 3) {
    parts.push('0');
  }
  return parts.join('.');
};

export type WindowsMetadata = {
  readonly title: string;
  readonly publisher: string;
  readonly version: string;
  readonly description: string;
  readonly hideConsole: boolean;
  /** Optional executable icon — must be a `.ico` (Bun does not convert on Windows). */
  readonly icon?: string;
};

export const buildCompileArgs = (
  entry: string,
  outfile: string,
  meta: WindowsMetadata,
): string[] => {
  const args = ['build', entry, '--compile', '--target=bun-windows-x64', '--outfile', outfile];
  // Shrink the binary WITHOUT mangling identifiers: mangling would rename the user
  // app's functions/classes, breaking Function.name, instanceof-by-name, and stack
  // traces at runtime. Whitespace + syntax minification keeps the size win safely.
  args.push('--minify-whitespace', '--minify-syntax');
  if (meta.hideConsole) {
    args.push('--windows-hide-console');
  }
  args.push('--windows-title', meta.title);
  args.push('--windows-publisher', meta.publisher);
  args.push('--windows-version', meta.version);
  args.push('--windows-description', meta.description);
  if (meta.icon !== undefined) {
    args.push('--windows-icon', meta.icon);
  }
  return args;
};

const spawnOk = async (cmd: readonly string[]): Promise<void> => {
  const proc = Bun.spawn(cmd as string[], { stdout: 'pipe', stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${cmd[0]} failed (exit ${exitCode}):\n${stderr}`);
  }
};

/**
 * Spawns the RUNNING Bun (`process.execPath`) rather than a bare `bun`, so the
 * build does not depend on Bun being on `$PATH`.
 */
const compileWindowsBinary = async (
  entry: string,
  outfile: string,
  meta: WindowsMetadata,
): Promise<void> => {
  await spawnOk([process.execPath, ...buildCompileArgs(entry, outfile, meta)]);
};

/**
 * Entry names use forward slashes (the ZIP convention) under a single
 * `<topPrefix>/` folder, so extracting yields one top-level directory.
 */
const collectZipEntries = (rootDir: string, topPrefix: string): ZipEntry[] => {
  const entries: ZipEntry[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, item.name);
      const relPath = rel === '' ? item.name : `${rel}/${item.name}`;
      if (item.isDirectory()) {
        walk(abs, relPath);
      } else {
        entries.push({ name: `${topPrefix}/${relPath}`, content: readFileSync(abs) });
      }
    }
  };
  walk(rootDir, '');
  return entries;
};

export type BuildWindowsAppOptions = {
  /** A built renderer directory to ship as `renderer/` beside the executable. */
  readonly rendererDir?: string;
  readonly entry: string;
  readonly name: string;
  readonly out?: string;
  /** App icon — a `.ico` embedded into the `.exe`. */
  readonly icon?: string;
  /** Engine-id to bake (the per-app pin); `system` is a no-op on Windows (no OS WebKit). */
  readonly engineId?: string;
  /** Directory of a WinCairo WebKit engine to bundle into the app's `webkit/` folder. */
  readonly embedEngine?: string;
};

export type BuildWindowsAppResult = {
  readonly appDir: string;
  readonly exePath: string;
  readonly zip: string;
};

export const buildWindowsApp = async (
  opts: BuildWindowsAppOptions,
): Promise<BuildWindowsAppResult> => {
  const out = opts.out ?? process.cwd();
  const layout = windowsLayout(out, opts.name);

  if (opts.icon !== undefined) {
    if (!existsSync(opts.icon)) {
      throw new Error(`bunmaska build: icon not found: ${opts.icon}`);
    }
    if (!opts.icon.toLowerCase().endsWith('.ico')) {
      throw new Error(`bunmaska build: --icon for Windows must be a .ico file (got ${opts.icon})`);
    }
  }

  // Validate the engine to embed BEFORE the (slow) compile, so a bad path fails fast.
  if (opts.embedEngine !== undefined && !existsSync(join(opts.embedEngine, 'WebKit2.dll'))) {
    throw new Error(
      `bunmaska build: --embed-engine directory has no WebKit2.dll: ${opts.embedEngine}`,
    );
  }

  mkdirSync(layout.appDir, { recursive: true });

  const meta: WindowsMetadata = {
    title: opts.name,
    publisher: 'Bunmaska',
    version: numericVersion(BUNMASKA_VERSION),
    description: `${opts.name} built with Bunmaska`,
    hideConsole: true,
    ...(opts.icon !== undefined ? { icon: opts.icon } : {}),
  };
  await compileWindowsBinary(opts.entry, layout.exePath, meta);

  // Bundle a module-using preload so it runs as a classic script in the packaged app.
  bundlePreloadAssets(layout.appDir, copyAppAssets(opts.entry, layout.appDir));
  if (opts.rendererDir !== undefined) {
    cpSync(opts.rendererDir, join(layout.appDir, 'renderer'), { recursive: true });
  }

  // Bake the engine-id the app pins, read at launch by the engine resolver.
  writeFileSync(layout.engineIdPath, `${opts.engineId ?? 'system'}\n`);

  // Copy the engine's whole directory closure (WebKit2.dll + ICU/libcurl/ANGLE +
  // the helper processes) into `<Name>/webkit/`, which the runtime finds next to
  // the executable, so the .exe runs with no env vars.
  if (opts.embedEngine !== undefined) {
    cpSync(opts.embedEngine, join(layout.appDir, BUNDLED_ENGINE_DIRNAME), { recursive: true });
  }

  const zip = join(out, zipFileName(opts.name));
  await Bun.write(zip, buildZipArchive(collectZipEntries(layout.appDir, opts.name)));

  return { appDir: layout.appDir, exePath: layout.exePath, zip };
};
