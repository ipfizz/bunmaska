#!/usr/bin/env bun

import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  type BunmaskaConfig,
  CONFIG_FILE_NAMES,
  configChannel,
  rendererOutDir,
} from '../common/config-schema';
import { type Arch, currentArch, currentPlatform, type Platform } from '../common/platform';
import { BUNMASKA_VERSION } from '../common/version';
import { buildLinuxApp, resolveBuildEngineId } from './build-linux';
import { debMaintainer } from './deb';
import {
  type BuildDmg,
  type BuildMacAppOptions,
  buildMacApp,
  type ConvertIcon,
  type SignApp,
} from './build-macos';
import { buildWindowsApp } from './build-windows';
import { loadConfig } from './config';
import {
  type ChangeAction,
  classifyChange,
  defaultDevDeps,
  devClassifier as projectClassifier,
  resolveDevEntry,
  runDev,
} from './dev';
import { buildRenderer } from './renderer-build';
import { runDoctor, runEngine } from './engine-command';
import { engineDir, enginesPath, isInstalled } from '../common/engine-store';
import { runInit } from './init';
import { runKeygen } from './keygen';
import { notarizeApp } from './notarize';
import { type BuildTarget, type Command, parseArgs, resolveTarget } from './parse-args';
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
  bunmaska doctor [dir]                  Report runtime, store, and the engine pin
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
                     windows takes a .ico (embedded into the .exe). A config
                     icon the target cannot use is skipped with a warning.
  --sign <identity>  Code-sign the macOS .app. Use '-' for an ad-hoc signature
                     (no certificate), or a 'Developer ID Application: Name
                     (TEAMID)' identity that is present in your keychain.
  --dmg              Also build a <Name>.dmg disk image of the macOS .app
                     (macOS-only; uses hdiutil), with an /Applications symlink.
  --notarize         Notarize the macOS .app (needs a Developer ID --sign, not
                     '-'): zips it, submits via 'xcrun notarytool --wait',
                     staples the ticket. Needs the env vars APPLE_ID, TEAM_ID
                     and an app-specific password in BUNMASKA_NOTARIZE_PASSWORD,
                     else it is skipped with guidance.
  --update           Also emit the auto-update feed beside the bundle: a
                     <name>-<channel>-<os>-<arch>.tar.zst and an update.json the
                     runtime autoUpdater reads. The arch is the host's (Windows:
                     always x64).
  --update-key <pem> Sign the --update feed: writes a detached .sig beside both
                     the .tar.zst and update.json with this Ed25519 private key
                     (generate one with 'bunmaska keygen'). Without it the feed
                     is unsigned and the runtime autoUpdater will refuse it.
  --channel <name>   Release channel for --update (default: the config's
                     updates.channel, else stable).
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

/** The icon types each target's builder can ship. */
const ICON_EXTENSIONS: Readonly<Record<BuildTarget, readonly string[]>> = {
  macos: ['.icns', '.png'],
  linux: ['.png'],
  windows: ['.ico'],
};

/** Notarizes a built .app (zip, submit --wait, staple). */
type NotarizeHook = (appPath: string) => Promise<void>;

export type DispatchDeps = {
  readonly buildMac?: (opts: BuildMacAppOptions) => Promise<string>;
  readonly buildLinux?: typeof buildLinuxApp;
  readonly buildWindows?: typeof buildWindowsApp;
  readonly runApp?: typeof runApp;
  readonly signApp?: SignApp;
  readonly notarize?: NotarizeHook;
  readonly convertIcon?: ConvertIcon;
  readonly buildDmg?: BuildDmg;
};

/** The project's package.json, or `{}` when it is absent or unreadable. */
const readAppPackage = (): Record<string, unknown> => {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    return typeof pkg === 'object' && pkg !== null ? (pkg as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** The app version from the project's package.json, or `0.0.0` if absent. */
const readAppVersion = (): string => {
  const version = readAppPackage()['version'];
  return typeof version === 'string' ? version : '0.0.0';
};

/** The `--update` feed to emit beside the bundle. */
type UpdateFeed = { readonly channel: string; readonly signingKeyPem: string | undefined };

/** Emit the `.tar.zst` + `update.json` (+ `.sig`) feed when there is one. */
const maybeEmitUpdate = async (
  feed: UpdateFeed | undefined,
  bundlePath: string,
  name: string,
  target: BuildTarget,
): Promise<void> => {
  if (feed === undefined) {
    return;
  }
  const { signingKeyPem } = feed;
  if (signingKeyPem === undefined) {
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
    channel: feed.channel,
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
  if (result.manifestSigPath !== undefined) {
    out(result.manifestSigPath);
  }
};

/** The project's engine pin for `target`; any other pin warns and falls back to the system WebKit. */
const resolveProjectEngine = (
  config: BunmaskaConfig,
  command: string,
  target: { readonly os: Platform; readonly arch: Arch } = {
    os: currentPlatform(),
    arch: currentArch(),
  },
): { engineId: string; embed: boolean } => {
  const webkitPin = config.engine?.webkit;
  const engineId = resolveBuildEngineId(webkitPin, target);
  if (webkitPin !== undefined && engineId === 'system' && webkitPin !== 'system') {
    err(
      `bunmaska ${command}: engine pin ${JSON.stringify(webkitPin)} is not a full engine id ` +
        `for ${target.os}-${target.arch} (see bunmaska engine available). Using the system WebKit.`,
    );
  }
  return { engineId, embed: config.engine?.embed === true };
};

/** dev and run must forward the pin, or on Windows the app launches with no engine. */
const launchEngineEnv = (config: BunmaskaConfig, command: string): Record<string, string> => {
  const { engineId } = resolveProjectEngine(config, command);
  return engineId === 'system' ? {} : { BUNMASKA_WEBKIT_ID: engineId };
};

const runBuild = async (
  command: Extract<Command, { kind: 'build' }>,
  deps: DispatchDeps,
): Promise<number> => {
  const { config } = await loadConfig(process.cwd());
  const entry = command.entry ?? config.entry;
  if (entry === undefined) {
    err(
      'bunmaska build: missing <entry.ts> - pass it explicitly or set `entry` in bunmaska.config.ts.',
    );
    return 1;
  }
  const target = resolveTarget(command.options.target);
  if (target === 'macos' && currentPlatform() !== 'macos') {
    err(
      `bunmaska build: --target macos requires a macOS host (this host is ${currentPlatform()}).`,
    );
    return 1;
  }
  const macOnly: readonly [string, boolean, string][] = [
    ['--sign', command.options.sign !== undefined, 'codesign'],
    ['--notarize', command.options.notarize === true, 'notarytool'],
    ['--dmg', command.options.dmg === true, 'hdiutil'],
  ];
  for (const [flag, given, tool] of macOnly) {
    if (given && target !== 'macos') {
      err(`bunmaska build: ${flag} is macOS-only (${tool}), with a macOS target on a macOS host.`);
      return 1;
    }
  }
  if (
    command.options.notarize === true &&
    (command.options.sign === undefined || command.options.sign === '-')
  ) {
    err(
      'bunmaska build: --notarize requires --sign with a Developer ID identity ' +
        '(Apple rejects unsigned and ad-hoc signed apps).',
    );
    return 1;
  }

  if (command.options.embedEngine !== undefined && target !== 'windows') {
    err('bunmaska build: --embed-engine is Windows-only.');
    return 1;
  }

  const name = command.options.name ?? config.name ?? deriveName(entry);
  const id = command.options.id ?? config.id;
  let icon = command.options.icon ?? config.icon;
  const iconTypes = ICON_EXTENSIONS[target];
  if (icon !== undefined && !iconTypes.includes(extname(icon).toLowerCase())) {
    // One config serves every target, so only an explicit --icon of the wrong type is an error.
    if (command.options.icon !== undefined) {
      err(`bunmaska build: --icon for ${target} must be ${iconTypes.join(' or ')} (got ${icon}).`);
      return 1;
    }
    err(
      `bunmaska build: skipping the config icon ${icon}; ${target} needs ${iconTypes.join(' or ')}.`,
    );
    icon = undefined;
  }

  const { update, updateKey, channel } = command.options;
  if (update !== true && (updateKey !== undefined || channel !== undefined)) {
    err('bunmaska build: --update-key and --channel need --update.');
    return 1;
  }
  // Fail fast on an unusable signing key rather than after the full build.
  let signingKeyPem: string | undefined;
  if (updateKey !== undefined) {
    try {
      signingKeyPem = readFileSync(updateKey, 'utf8');
      createPrivateKey(signingKeyPem);
    } catch {
      err(
        `bunmaska build: --update-key ${updateKey} is not a readable private key ` +
          '(bunmaska keygen writes it as update-signing-key.pem).',
      );
      return 1;
    }
  }
  const feed =
    update === true ? { channel: channel ?? configChannel(config), signingKeyPem } : undefined;

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
    const { engineId, embed } = resolveProjectEngine(config, 'build', {
      os: 'linux',
      arch: currentArch(),
    });
    if (embed) {
      // Embedding drops the .deb's WebKitGTK Depends, so no engine crashes a clean box.
      // ponytail: Linux refuses engine.embed; copy the store engine in, as Windows does.
      err('bunmaska build: engine.embed is not supported on Linux yet; remove it or set it false.');
      return 1;
    }
    const maintainer = debMaintainer(readAppPackage()['author']);
    const result = await (deps.buildLinux ?? buildLinuxApp)({
      entry,
      name,
      engineId,
      version: readAppVersion(),
      ...(maintainer !== undefined ? { maintainer } : {}),
      ...(id !== undefined ? { id } : {}),
      ...(command.options.out !== undefined ? { out: command.options.out } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(rendererDir !== undefined ? { rendererDir } : {}),
    });
    out(result.appDir);
    out(result.tarball);
    out(result.deb);
    await maybeEmitUpdate(feed, result.appDir, name, 'linux');
    return 0;
  }

  if (target === 'windows') {
    const { engineId, embed } = resolveProjectEngine(config, 'build', {
      os: 'windows',
      arch: 'x64',
    });
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
      version: readAppVersion(),
      ...(command.options.out !== undefined ? { out: command.options.out } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(embedEngine !== undefined ? { embedEngine } : {}),
      ...(rendererDir !== undefined ? { rendererDir } : {}),
    });
    out(result.appDir);
    out(result.exePath);
    out(result.zip);
    await maybeEmitUpdate(feed, result.appDir, name, 'windows');
    return 0;
  }

  let notarize: NotarizeHook | undefined;
  if (command.options.notarize === true) {
    const creds = notarizeCredentials();
    if (creds === undefined) {
      err(
        'bunmaska build: notarization requires APPLE_ID/TEAM_ID and an app-specific password ' +
          '(env BUNMASKA_NOTARIZE_PASSWORD) - see docs. Skipping notarization.',
      );
    } else {
      notarize = deps.notarize ?? ((app: string): Promise<void> => notarizeApp(app, creds));
    }
  }
  const buildMac = deps.buildMac ?? buildMacApp;
  const appPath = await buildMac({
    entry,
    name,
    version: readAppVersion(),
    ...(id !== undefined ? { id } : {}),
    ...(command.options.out !== undefined ? { out: command.options.out } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(command.options.sign !== undefined ? { sign: command.options.sign } : {}),
    ...(command.options.dmg === true ? { dmg: true } : {}),
    ...(notarize !== undefined ? { notarize } : {}),
    ...(deps.signApp !== undefined ? { signApp: deps.signApp } : {}),
    ...(deps.convertIcon !== undefined ? { convertIcon: deps.convertIcon } : {}),
    ...(deps.buildDmg !== undefined ? { buildDmg: deps.buildDmg } : {}),
    ...(rendererDir !== undefined ? { rendererDir } : {}),
  });
  out(appPath);
  await maybeEmitUpdate(feed, appPath, name, 'macos');
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
  const result = runInit(command.dir, command.name);
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
 * The dev loop's classifier: the project graph (renderer.copy sources, the entry's
 * imports), renderer output reloads, and a config edit asks for a dev restart.
 */
export const devClassifier = (
  dir: string,
  config: BunmaskaConfig,
  entry: string,
  log: (message: string) => void,
): ((relPath: string) => ChangeAction) => {
  const renderer = config.renderer;
  const project = projectClassifier(
    dir,
    entry,
    renderer === undefined
      ? undefined
      : { ...renderer, entry: relative(dir, resolve(dir, renderer.entry)) },
  );
  const outDir = renderer === undefined ? undefined : resolve(dir, rendererOutDir(renderer)) + sep;
  return (relPath) => {
    if (CONFIG_FILE_NAMES.includes(relPath)) {
      log(`${relPath} changed; restart bunmaska dev to apply it.`);
      return 'ignore';
    }
    // Output writes must reload, not rebuild again: an outDir may sit inside the renderer dir.
    if (outDir !== undefined && resolve(dir, relPath).startsWith(outDir)) {
      return classifyChange(relPath);
    }
    return project(relPath);
  };
};

const runDevCommand = async (command: Extract<Command, { kind: 'dev' }>): Promise<number> => {
  const { config } = await loadConfig(process.cwd());
  const entry = resolveDevEntry(config, command.entry);
  const renderer = config.renderer;
  const dir = process.cwd();
  const log = (message: string): void => out(message);
  const baseDeps = {
    ...defaultDevDeps(dir, log, launchEngineEnv(config, 'dev')),
    classify: devClassifier(dir, config, entry, log),
  };
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
    deps = { ...baseDeps, rebuild };
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
    case 'run': {
      const { config } = await loadConfig(process.cwd());
      const extraEnv = launchEngineEnv(config, 'run');
      return await (deps.runApp ?? runApp)(command.entry, command.args, { extraEnv });
    }
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
