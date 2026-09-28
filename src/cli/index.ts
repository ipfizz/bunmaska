#!/usr/bin/env bun

/**
 * The `bunmaska` command-line interface. Output goes through
 * `process.stdout`/`process.stderr` because Biome bans `console.*`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type BunmaskaRendererConfig, rendererOutDir } from '../common/config-schema';
import { DEFAULT_CHANNEL } from '../common/manifest';
import { currentArch, currentPlatform } from '../common/platform';
import { BUNMASKA_VERSION } from '../common/version';
import { buildLinuxApp, resolveBuildEngineId } from './build-linux';
import {
  type BuildDmg,
  type BuildMacAppOptions,
  buildDmg,
  buildMacApp,
  type ConvertIcon,
  type SignApp,
} from './build-macos';
import { buildWindowsApp } from './build-windows';
import { loadConfig } from './config';
import { type ChangeAction, classifyChange, defaultDevDeps, resolveDevEntry, runDev } from './dev';
import { buildRenderer } from './renderer-build';
import { runDoctor, runEngine } from './engine-command';
import { engineDir, enginesPath, isInstalled } from './engine-store';
import { runInit } from './init';
import { runKeygen } from './keygen';
import { notarizeApp } from './notarize';
import {
  type BuildOptions,
  type BuildTarget,
  type Command,
  parseArgs,
  resolveTarget,
} from './parse-args';
import { runApp } from './run';
import { emitUpdateArtifact } from './update-artifact';

const out = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const err = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

const USAGE = `bunmaska ${BUNMASKA_VERSION}

Usage:
  bunmaska init [dir]                    Scaffold a new Bunmaska project (default: .)
  bunmaska init <name> <dir>             ...named <name>, e.g. init my-app .
  bunmaska dev [entry.ts]                Run the app, restarting on file changes
  bunmaska run <entry.ts> [args...]      Launch a Bunmaska app (bun run <entry>)
  bunmaska build [entry.ts] [options]    Bundle a distributable app (entry defaults
                                         to the config's "entry")
  bunmaska engine <subcommand>           Manage the pinned-WebKit engine store
  bunmaska keygen [--out <dir>]          Generate the Ed25519 update-signing key
                                         pair (private + public .pem)
  bunmaska doctor [dir]                   Report runtime, store, and the engine pin
  bunmaska --help                        Show this help
  bunmaska --version                     Print the Bunmaska version

engine subcommands:
  list                  Installed engines (side by side) and their refcounts
  available             Engines published on the feed (marks installed + this-machine)
  which [dir]           The engine-id a project resolves (defaults to system)
  install <id|path|url> Install an engine: an engine-id (from the official feed),
                        a local engine directory, or a signed published .tar.zst URL
  use <id> [--for dir]  Pin an engine per-project (there is no global switch)
  prune [--dry-run]     Garbage-collect engines no installed app references
                        (use --force to prune when no app has registered yet)
  verify <id>           Structurally verify an installed engine

build options:
  --target <os>      Build target: macos | linux | windows (default: host platform)
  --name <Name>      Display/bundle name (default: derived from <entry>)
  --id <bundle.id>   Bundle identifier (default: com.bunmaska.<name-slug>)
  --out <dir>        Output directory (default: current directory)
  --icon <path>      App icon. macOS accepts a .icns (copied as-is) or a .png
                     (converted to .icns via sips/iconutil); linux takes a .png;
                     windows takes a .ico (embedded into the .exe).
  --sign <identity>  Code-sign the macOS .app. Use '-' for an ad-hoc signature
                     (no certificate), or a 'Developer ID Application: Name
                     (TEAMID)' identity that is present in your keychain.
  --dmg              Also build a <Name>.dmg disk image of the macOS .app
                     (macOS-only; uses hdiutil), with an /Applications symlink.
  --notarize         Notarize the macOS .app (with --sign): zips it, submits
                     via 'xcrun notarytool --wait', staples the ticket. Needs
                     the env vars APPLE_ID, TEAM_ID and an app-specific
                     password in BUNMASKA_NOTARIZE_PASSWORD, else it is skipped
                     with guidance.
  --update           Also emit the auto-update feed beside the bundle: a
                     <name>-<channel>-<os>-<arch>.tar.zst and an update.json the
                     runtime autoUpdater reads. The arch is the host's (Windows:
                     always x64).
  --update-key <pem> Sign the --update artifact: writes a detached .sig beside
                     the .tar.zst with this Ed25519 private key (generate one
                     with 'bunmaska keygen'). Without it the feed is unsigned
                     and the runtime autoUpdater will refuse it.
  --channel <name>   Release channel for --update (default: stable).
  --embed-engine <dir>  Windows only: bundle a WinCairo WebKit engine directory
                     into the app's webkit/ folder so the built .exe runs with no
                     environment variables (otherwise launch needs the engine
                     store or BUNMASKA_WEBKIT_PATH).

'bunmaska build' produces a macOS .app, a Linux AppDir + .tar.gz + .deb, or a
Windows portable dir + .zip. --target cross-builds (e.g. a macOS host can build
Linux or Windows). --sign and --notarize are macOS-only (codesign/notarytool).`;

const deriveName = (entry: string): string => {
  const base = entry.split(/[\\/]/).pop() ?? entry;
  const stem = base.replace(/\.[^.]+$/, '');
  return stem.length > 0 ? stem : 'BunmaskaApp';
};

/** Argv builder + runner for the `xcrun notarytool submit` release hook. */
type NotarizeHook = (appPath: string) => Promise<void>;

export type DispatchDeps = {
  readonly buildMac?: (opts: BuildMacAppOptions) => Promise<string>;
  readonly buildLinux?: typeof buildLinuxApp;
  readonly buildWindows?: typeof buildWindowsApp;
  readonly signApp?: SignApp;
  readonly notarize?: NotarizeHook;
  readonly convertIcon?: ConvertIcon;
  readonly buildDmg?: BuildDmg;
};

/** Read the app version from the project's package.json, or `0.0.0` if absent. */
const readAppVersion = (): string => {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
};

/** When `--update` was given, emit the `.tar.zst` + `update.json` (+ `.sig`) feed. */
const maybeEmitUpdate = async (
  bundlePath: string,
  name: string,
  target: BuildTarget,
  options: BuildOptions,
): Promise<void> => {
  if (options.update !== true) {
    return;
  }
  let signingKeyPem: string | undefined;
  if (options.updateKey !== undefined) {
    signingKeyPem = readFileSync(options.updateKey, 'utf8');
  } else {
    err(
      'bunmaska build: WARNING: the update feed is UNSIGNED (no --update-key). ' +
        'The runtime autoUpdater refuses unsigned updates; sign with ' +
        '--update-key <private.pem> (generate a pair with `bunmaska keygen`).',
    );
  }
  const result = await emitUpdateArtifact({
    bundlePath,
    outDir: dirname(bundlePath),
    name,
    version: readAppVersion(),
    channel: options.channel ?? DEFAULT_CHANNEL,
    os: target,
    // buildWindowsApp always compiles bun-windows-x64, whatever the host.
    arch: target === 'windows' ? 'x64' : currentArch(),
    ...(signingKeyPem === undefined ? {} : { signingKeyPem }),
  });
  out(result.artifactPath);
  out(result.manifestPath);
  if (result.sigPath !== undefined) {
    out(result.sigPath);
  }
};

/**
 * Warns when a bare upstream version cannot yet resolve to a full id. Shared by
 * the Linux and Windows build branches.
 */
const resolveProjectEngine = async (): Promise<{ engineId: string; embed: boolean }> => {
  const { config } = await loadConfig(process.cwd());
  const webkitPin = config.engine?.webkit;
  const engineId = resolveBuildEngineId(webkitPin);
  if (webkitPin !== undefined && engineId === 'system' && webkitPin !== 'system') {
    err(
      `bunmaska build: engine pin ${JSON.stringify(webkitPin)} is a bare version; ` +
        'resolving it to a full engine-id needs the engine catalog (a follow-up). ' +
        'Baking the system WebKit for now.',
    );
  }
  return { engineId, embed: config.engine?.embed === true };
};

const runBuild = async (
  command: Extract<Command, { kind: 'build' }>,
  deps: DispatchDeps,
): Promise<number> => {
  // The explicit argument wins, then the config - mirroring `bunmaska dev`.
  const { config } = await loadConfig(process.cwd());
  const entry = command.entry ?? config.entry;
  if (entry === undefined) {
    err(
      'bunmaska build: missing <entry.ts> — pass it explicitly or set `entry` in bunmaska.config.ts.',
    );
    return 1;
  }
  const target = resolveTarget(command.options.target);
  // Only macOS hosts can produce a macOS .app; Linux distributables cross-build
  // from macOS (and build natively on Linux).
  if (target === 'macos' && currentPlatform() !== 'macos') {
    err(
      `bunmaska build: --target macos requires a macOS host (this host is ${currentPlatform()}).`,
    );
    return 1;
  }
  // codesign/notarytool are macOS tools and only meaningful for the macOS .app.
  if (command.options.sign !== undefined && (target !== 'macos' || currentPlatform() !== 'macos')) {
    err('bunmaska build: --sign is macOS-only (codesign), with a macOS target on a macOS host.');
    return 1;
  }
  if (command.options.notarize === true && (target !== 'macos' || currentPlatform() !== 'macos')) {
    err(
      'bunmaska build: --notarize is macOS-only (notarytool), with a macOS target on a macOS host.',
    );
    return 1;
  }
  // hdiutil is a macOS tool and the .dmg only wraps the macOS .app.
  if (command.options.dmg === true && (target !== 'macos' || currentPlatform() !== 'macos')) {
    err('bunmaska build: --dmg is macOS-only (hdiutil), with a macOS target on a macOS host.');
    return 1;
  }

  if (command.options.embedEngine !== undefined && target !== 'windows') {
    err('bunmaska build: --embed-engine is Windows-only.');
    return 1;
  }

  // Flag > bunmaska.config.ts > derived from the entry file name.
  const name = command.options.name ?? config.name ?? deriveName(entry);
  const id = command.options.id ?? config.id;
  const icon = command.options.icon ?? config.icon;

  // Fail fast on an unreadable signing key: discovering it after a full build
  // wastes the build and surfaced as a raw stack.
  if (command.options.updateKey !== undefined) {
    try {
      readFileSync(command.options.updateKey, 'utf8');
    } catch {
      err(`bunmaska build: cannot read --update-key ${command.options.updateKey}`);
      return 1;
    }
  }

  // A configured renderer builds first and ships as `renderer/` beside the
  // executable; nothing else in the build copies it (assets are entry siblings).
  let rendererDir: string | undefined;
  const rendererConfig = config.renderer;
  if (rendererConfig !== undefined) {
    const rendererResult = await buildRenderer(process.cwd(), rendererConfig, 'production');
    rendererDir = rendererResult.outDir;
    out(`renderer built (${rendererResult.written.join(', ')})`);
  }

  if (target === 'linux') {
    const { engineId, embed } = await resolveProjectEngine();
    if (embed) {
      // Dropping the .deb dependency without shipping an engine would crash on a
      // clean box; refuse until Linux embedding exists.
      err('bunmaska build: engine.embed is not supported on Linux yet; remove it or set it false.');
      return 1;
    }
    const result = await (deps.buildLinux ?? buildLinuxApp)({
      entry,
      name,
      engineId,
      version: readAppVersion(),
      ...(id !== undefined ? { id } : {}),
      ...(command.options.out !== undefined ? { out: command.options.out } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(rendererDir !== undefined ? { rendererDir } : {}),
    });
    out(result.appDir);
    out(result.tarball);
    out(result.deb);
    await maybeEmitUpdate(result.appDir, name, 'linux', command.options);
    return 0;
  }

  if (target === 'windows') {
    const { engineId, embed } = await resolveProjectEngine();
    let embedEngine = command.options.embedEngine;
    if (embedEngine === undefined && embed) {
      const root = enginesPath();
      if (engineId === 'system' || !isInstalled(root, engineId)) {
        err(
          `bunmaska build: engine.embed needs the pinned engine installed (${engineId}); ` +
            'run bunmaska engine install <engine-id> first.',
        );
        return 1;
      }
      embedEngine = join(engineDir(root, engineId), 'lib');
    }
    const result = await (deps.buildWindows ?? buildWindowsApp)({
      entry,
      name,
      engineId,
      ...(command.options.out !== undefined ? { out: command.options.out } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(embedEngine !== undefined ? { embedEngine } : {}),
      ...(rendererDir !== undefined ? { rendererDir } : {}),
    });
    out(result.appDir);
    out(result.exePath);
    out(result.zip);
    await maybeEmitUpdate(result.appDir, name, 'windows', command.options);
    return 0;
  }

  // A .dmg must wrap the stapled .app, so with --notarize it is built afterwards.
  const dmgAfterNotarize = command.options.dmg === true && command.options.notarize === true;
  const buildMac = deps.buildMac ?? buildMacApp;
  const appPath = await buildMac({
    entry,
    name,
    ...(id !== undefined ? { id } : {}),
    ...(command.options.out !== undefined ? { out: command.options.out } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(command.options.sign !== undefined ? { sign: command.options.sign } : {}),
    ...(command.options.dmg === true && !dmgAfterNotarize ? { dmg: true } : {}),
    ...(deps.signApp !== undefined ? { signApp: deps.signApp } : {}),
    ...(deps.convertIcon !== undefined ? { convertIcon: deps.convertIcon } : {}),
    ...(deps.buildDmg !== undefined ? { buildDmg: deps.buildDmg } : {}),
    ...(rendererDir !== undefined ? { rendererDir } : {}),
  });
  out(appPath);

  // Without Apple credentials we print guidance and do NOT submit to Apple;
  // with them the default hook zips, submits (--wait) and staples.
  if (command.options.notarize === true) {
    const creds = notarizeCredentials();
    if (creds === undefined) {
      err(
        'bunmaska build: notarization requires APPLE_ID/TEAM_ID and an app-specific password ' +
          '(env BUNMASKA_NOTARIZE_PASSWORD) — see docs. Skipping notarization.',
      );
    } else {
      const notarize = deps.notarize ?? ((app: string): Promise<void> => notarizeApp(app, creds));
      await notarize(appPath);
    }
  }
  if (dmgAfterNotarize) {
    const outDmg = join(dirname(appPath), `${name}.dmg`);
    await (deps.buildDmg ?? buildDmg)({ appDir: appPath, name, outDmg });
  }
  await maybeEmitUpdate(appPath, name, 'macos', command.options);
  return 0;
};

/** Read notarization credentials from the environment, or undefined if incomplete. */
const notarizeCredentials = ():
  | { readonly appleId: string; readonly teamId: string; readonly password: string }
  | undefined => {
  const appleId = process.env['APPLE_ID'];
  const teamId = process.env['TEAM_ID'];
  const password = process.env['BUNMASKA_NOTARIZE_PASSWORD'];
  if (appleId === undefined || teamId === undefined || password === undefined) {
    return undefined;
  }
  return { appleId, teamId, password };
};

const runInitCommand = (command: Extract<Command, { kind: 'init' }>): number => {
  const result = runInit(command.dir, undefined, command.name);
  out(`Scaffolded ${result.name} in ${result.dir}`);
  for (const path of result.written) {
    out(`  create ${path}`);
  }
  out('');
  out('Next steps:');
  if (command.dir !== '.') {
    out(`  cd ${command.dir}`);
  }
  out('  bun install');
  out('  bun run dev');
  return 0;
};

const engineCommandDeps = (): Parameters<typeof runEngine>[1] => ({
  root: enginesPath(),
  env: process.env,
  out,
  err,
  readConfig: async (target) => (await loadConfig(target)).config,
});

/** Block until SIGINT/SIGTERM, then run `stop` and resolve. */
const awaitInterrupt = (stop: () => void): Promise<void> =>
  new Promise<void>((resolvePromise) => {
    const onSignal = (): void => {
      stop();
      resolvePromise();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });

/**
 * The engine env a launched app needs to resolve its `engine.webkit` pin. Only
 * `build`/`doctor` used to read the pin, so `dev` and `run` silently launched on
 * the system WebKit — which on Windows means no engine at all.
 */
const launchEngineEnv = async (): Promise<Record<string, string>> => {
  const { config } = await loadConfig(process.cwd());
  const engineId = resolveBuildEngineId(config.engine?.webkit);
  return engineId === 'system' ? {} : { BUNMASKA_WEBKIT_ID: engineId };
};

/** {@link classifyChange} with the renderer's entry and outDir resolved against `dir`. */
export const rendererClassifier = (
  dir: string,
  renderer: BunmaskaRendererConfig,
): ((relPath: string) => ChangeAction) => {
  const root = relative(dir, dirname(resolve(dir, renderer.entry)));
  const outDir = resolve(dir, rendererOutDir(renderer)) + sep;
  // Output writes must reload, not rebuild again: an outDir may sit inside the root.
  return (relPath) =>
    classifyChange(relPath, resolve(dir, relPath).startsWith(outDir) ? undefined : root);
};

const runDevCommand = async (command: Extract<Command, { kind: 'dev' }>): Promise<number> => {
  const { config } = await loadConfig(process.cwd());
  const entry = resolveDevEntry(config, command.entry);
  const renderer = config.renderer;
  const dir = process.cwd();
  const log = (message: string): void => out(message);
  const baseDeps = defaultDevDeps(dir, log, await launchEngineEnv());
  let deps = baseDeps;
  if (renderer !== undefined) {
    const rendererConfig = renderer;
    const rebuild = async (): Promise<void> => {
      // A broken renderer edit must never take the dev loop down with it.
      try {
        const result = await buildRenderer(dir, rendererConfig, 'development');
        log(`renderer rebuilt (${result.written.join(', ')})`);
      } catch (error) {
        err(error instanceof Error ? error.message : String(error));
      }
    };
    // Build once up front so the first launch shows current code.
    await rebuild();
    deps = {
      ...baseDeps,
      classify: rendererClassifier(dir, rendererConfig),
      rebuild,
    };
  }
  out(`bunmaska dev: running ${entry} (Ctrl-C to stop)`);
  await runDev(dir, entry, awaitInterrupt, deps);
  return 0;
};

const runCommand = async (command: Command, deps: DispatchDeps): Promise<number> => {
  switch (command.kind) {
    case 'help':
      out(USAGE);
      return 0;
    case 'version':
      out(BUNMASKA_VERSION);
      return 0;
    case 'init':
      return runInitCommand(command);
    case 'dev':
      return await runDevCommand(command);
    case 'run':
      return await runApp(command.entry, command.args, { extraEnv: await launchEngineEnv() });
    case 'build':
      return await runBuild(command, deps);
    case 'engine':
      return await runEngine(command.sub, engineCommandDeps());
    case 'keygen':
      return runKeygen(command.out ?? process.cwd(), { out, err });
    case 'doctor':
      return await runDoctor(command.target, engineCommandDeps());
    case 'error':
      err(command.message);
      err('');
      err(USAGE);
      return 1;
  }
};

/** Run a parsed {@link Command} to its exit code; any failure prints as one stderr line. */
export const dispatch = async (command: Command, deps: DispatchDeps = {}): Promise<number> => {
  try {
    return await runCommand(command, deps);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
};

const main = async (): Promise<void> => {
  const command = parseArgs(process.argv.slice(2));
  process.exit(await dispatch(command));
};

// Only auto-run when invoked as the CLI entry, never on import (e.g. in tests).
if (import.meta.main) {
  await main();
}
