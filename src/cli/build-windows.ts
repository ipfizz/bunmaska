/**
 * Windows distributable builder for the `bunmaska` CLI.
 *
 * The app is cross/native compiled to a single self-contained `.exe` with Bun's
 * `--compile --target=bun-windows-x64`, which embeds the Bun runtime and the
 * app's JS into a Windows PE (this works from a macOS or Linux host too). No
 * Windows ships no system WebKit, so at launch Bunmaska `dlopen`s a WinCairo
 * `WebKit2.dll`. With `--embed-engine`, that engine's whole directory is copied
 * into the bundle's `webkit/` folder so the built `.exe` runs with NO environment
 * variables (the runtime resolves a `webkit/` next to the executable — see
 * `webkit2-ffi.ts`); without it, the launch relies on the engine store (the baked
 * `engine.id`) or `BUNMASKA_WEBKIT_PATH`. The output is a portable `<Name>/`
 * directory packaged as a `.zip`. The pure parts (layout paths, compile argv,
 * version normalisation, archive name) are factored out for unit testing; the
 * `.zip` is written with the pure `zip.ts` writer so the build spawns no archiver.
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

/** Compute every on-disk path of an `<out>/<Name>` portable tree. Pure. */
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

/** File name of the `.zip` distributable for an app. Pure. */
export const zipFileName = (name: string): string => `${name}-windows-x64.zip`;

/**
 * Reduce a SemVer-ish version to the numeric `major.minor.patch` that a Windows
 * PE VERSIONINFO resource (`--windows-version`) accepts: drop `+build` metadata
 * and any `-prerelease`, keep the first three segments, zero-pad short ones, and
 * substitute `0` for a non-numeric segment. `0.1.0-alpha.2` -> `0.1.0`. Pure.
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

/** PE metadata + console behaviour baked into the compiled `.exe`. */
export type WindowsMetadata = {
  readonly title: string;
  readonly publisher: string;
  readonly version: string;
  readonly description: string;
  /** Suppress the console window for the GUI app (Electron-equivalent default). */
  readonly hideConsole: boolean;
  /** Optional executable icon — must be a `.ico` (Bun does not convert on Windows). */
  readonly icon?: string;
};

/**
 * Build the `bun build` argv (everything after `bun`) that compiles `entry` to a
 * standalone Windows `.exe` at `outfile` with the given PE metadata. Pure.
 */
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

/** Run a command, throwing with stderr on a non-zero exit. */
const spawnOk = async (cmd: readonly string[]): Promise<void> => {
  const proc = Bun.spawn(cmd as string[], { stdout: 'pipe', stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${cmd[0]} failed (exit ${exitCode}):\n${stderr}`);
  }
};

/**
 * Cross/native compile `entry` to a Windows `.exe` at `outfile`. Spawns the
 * RUNNING Bun (`process.execPath`) rather than a bare `bun`, so the build does
 * not depend on Bun being on `$PATH` and always compiles with this same runtime.
 * Throws on failure.
 */
const compileWindowsBinary = async (
  entry: string,
  outfile: string,
  meta: WindowsMetadata,
): Promise<void> => {
  await spawnOk([process.execPath, ...buildCompileArgs(entry, outfile, meta)]);
};

/**
 * Recursively collect every file under `rootDir` into ZIP entries whose names
 * are `<topPrefix>/<relative/path>` with forward slashes (the ZIP convention),
 * so extracting yields a single `<topPrefix>/` folder.
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

/**
 * Produce the Windows distributables for `entry`: a portable `<Name>/` dir with
 * the compiled `.exe` and the baked `engine.id`, plus a `.zip` of it. Returns the
 * produced paths.
 */
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

  // Ship the entry's runtime assets (the page, the preload) beside the binary, then
  // bundle a module-using preload so it runs as a classic script in the packaged app.
  bundlePreloadAssets(layout.appDir, copyAppAssets(opts.entry, layout.appDir));

  // Bake the engine-id the app pins, read at launch by the engine resolver.
  writeFileSync(layout.engineIdPath, `${opts.engineId ?? 'system'}\n`);

  // Bundle the WinCairo engine so the .exe runs with no env vars: copy its whole
  // directory closure (WebKit2.dll + ICU/libcurl/ANGLE + the helper processes)
  // into `<Name>/webkit/`, which the runtime finds next to the executable. The
  // directory was validated above (fail-fast, before the compile).
  if (opts.embedEngine !== undefined) {
    cpSync(opts.embedEngine, join(layout.appDir, BUNDLED_ENGINE_DIRNAME), { recursive: true });
  }

  // .zip the portable dir with the <Name>/ folder as the single top level.
  const zip = join(out, zipFileName(opts.name));
  await Bun.write(zip, buildZipArchive(collectZipEntries(layout.appDir, opts.name)));

  return { appDir: layout.appDir, exePath: layout.exePath, zip };
};
