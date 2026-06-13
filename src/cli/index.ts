#!/usr/bin/env bun
/**
 * The `sambar` command-line interface: `run`, `build`, `--help`, `--version`.
 *
 * This is the user-facing build/launch tool, not a runtime module — it uses
 * Bun/Node filesystem and process APIs only. Output goes through
 * `process.stdout`/`process.stderr` because Biome bans `console.*`.
 */

import { buildLinuxApp } from './build-linux';
import {
  type BuildDmg,
  type BuildMacAppOptions,
  buildMacApp,
  type ConvertIcon,
  type SignApp,
} from './build-macos';
import { loadConfig } from './config';
import { resolveDevEntry, runDev } from './dev';
import { runInit } from './init';
import { type Command, parseArgs, resolveTarget } from './parse-args';
import { runApp } from './run';
import { currentPlatform } from '../common/platform';
import { SAMBAR_VERSION } from '../common/version';

const out = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const err = (text: string): void => {
  process.stderr.write(`${text}\n`);
};

const USAGE = `sambar ${SAMBAR_VERSION}

Usage:
  sambar init [dir]                    Scaffold a new Sambar project (default: .)
  sambar dev [entry.ts]                Run the app, restarting on file changes
  sambar run <entry.ts> [args...]      Launch a Sambar app (bun run <entry>)
  sambar build <entry.ts> [options]    Bundle a distributable app
  sambar --help                        Show this help
  sambar --version                     Print the Sambar version

build options:
  --target <os>      Build target: macos | linux (default: host platform)
  --name <Name>      Display/bundle name (default: derived from <entry>)
  --id <bundle.id>   Bundle identifier (default: com.sambar.<name-slug>)
  --out <dir>        Output directory (default: current directory)
  --icon <path>      App icon. macOS accepts a .icns (copied as-is) or a .png
                     (converted to .icns via sips/iconutil); linux takes a .png.
  --sign <identity>  Code-sign the macOS .app. Use '-' for an ad-hoc signature
                     (no certificate), or a 'Developer ID Application: Name
                     (TEAMID)' identity that is present in your keychain.
  --dmg              Also build a <Name>.dmg disk image of the macOS .app
                     (macOS-only; uses hdiutil), with an /Applications symlink.
  --notarize         Notarization hook (macOS, with --sign). Requires the env
                     vars APPLE_ID, TEAM_ID and an app-specific password; this
                     build does not submit to Apple — see the docs to release.

'sambar build' produces a macOS .app or a Linux AppDir + .tar.gz + .deb.
A macOS host can cross-build Linux with --target linux.
--sign and --notarize are macOS-only (codesign/notarytool are macOS tools).`;

/** Derive a default app name from the entry path's base file name. */
const deriveName = (entry: string): string => {
  const base = entry.split(/[\\/]/).pop() ?? entry;
  const stem = base.replace(/\.[^.]+$/, '');
  return stem.length > 0 ? stem : 'SambarApp';
};

/** Argv builder + runner for the `xcrun notarytool submit` release hook. */
type NotarizeHook = (appPath: string) => Promise<void>;

/** Injectable seams so `dispatch` is unit-testable without shelling out. */
export type DispatchDeps = {
  readonly buildMac?: (opts: BuildMacAppOptions) => Promise<string>;
  readonly signApp?: SignApp;
  readonly notarize?: NotarizeHook;
  readonly convertIcon?: ConvertIcon;
  readonly buildDmg?: BuildDmg;
};

const runBuild = async (
  command: Extract<Command, { kind: 'build' }>,
  deps: DispatchDeps,
): Promise<number> => {
  const target = resolveTarget(command.options.target);
  // Only macOS hosts can produce a macOS .app; Linux distributables cross-build
  // from macOS (and build natively on Linux).
  if (target === 'macos' && currentPlatform() !== 'macos') {
    err(`sambar build: --target macos requires a macOS host (this host is ${currentPlatform()}).`);
    return 1;
  }
  // codesign/notarytool are macOS tools and only meaningful for the macOS .app.
  if (command.options.sign !== undefined && (target !== 'macos' || currentPlatform() !== 'macos')) {
    err('sambar build: --sign is macOS-only (codesign), with a macOS target on a macOS host.');
    return 1;
  }
  if (command.options.notarize === true && (target !== 'macos' || currentPlatform() !== 'macos')) {
    err(
      'sambar build: --notarize is macOS-only (notarytool), with a macOS target on a macOS host.',
    );
    return 1;
  }
  // hdiutil is a macOS tool and the .dmg only wraps the macOS .app.
  if (command.options.dmg === true && (target !== 'macos' || currentPlatform() !== 'macos')) {
    err('sambar build: --dmg is macOS-only (hdiutil), with a macOS target on a macOS host.');
    return 1;
  }

  const name = command.options.name ?? deriveName(command.entry);
  if (target === 'linux') {
    const result = await buildLinuxApp({
      entry: command.entry,
      name,
      ...(command.options.id !== undefined ? { id: command.options.id } : {}),
      ...(command.options.out !== undefined ? { out: command.options.out } : {}),
      ...(command.options.icon !== undefined ? { icon: command.options.icon } : {}),
    });
    out(result.appDir);
    out(result.tarball);
    out(result.deb);
    return 0;
  }

  const buildMac = deps.buildMac ?? buildMacApp;
  const appPath = await buildMac({
    entry: command.entry,
    name,
    ...(command.options.id !== undefined ? { id: command.options.id } : {}),
    ...(command.options.out !== undefined ? { out: command.options.out } : {}),
    ...(command.options.icon !== undefined ? { icon: command.options.icon } : {}),
    ...(command.options.sign !== undefined ? { sign: command.options.sign } : {}),
    ...(command.options.dmg === true ? { dmg: true } : {}),
    ...(deps.signApp !== undefined ? { signApp: deps.signApp } : {}),
    ...(deps.convertIcon !== undefined ? { convertIcon: deps.convertIcon } : {}),
    ...(deps.buildDmg !== undefined ? { buildDmg: deps.buildDmg } : {}),
  });
  out(appPath);

  // Notarization is a documented release HOOK: without Apple credentials we
  // print guidance and do NOT submit to Apple.
  if (command.options.notarize === true) {
    const creds = notarizeCredentials();
    if (creds === undefined) {
      err(
        'sambar build: notarization requires APPLE_ID/TEAM_ID and an app-specific password ' +
          '(env SAMBAR_NOTARIZE_PASSWORD) — see docs. Skipping notarization.',
      );
    } else if (deps.notarize !== undefined) {
      await deps.notarize(appPath);
    }
  }
  return 0;
};

/** Read notarization credentials from the environment, or undefined if incomplete. */
const notarizeCredentials = ():
  | { readonly appleId: string; readonly teamId: string; readonly password: string }
  | undefined => {
  const appleId = process.env['APPLE_ID'];
  const teamId = process.env['TEAM_ID'];
  const password = process.env['SAMBAR_NOTARIZE_PASSWORD'];
  if (appleId === undefined || teamId === undefined || password === undefined) {
    return undefined;
  }
  return { appleId, teamId, password };
};

/** Scaffold a new project and print next steps. Returns the exit code. */
const runInitCommand = (command: Extract<Command, { kind: 'init' }>): number => {
  let result: ReturnType<typeof runInit>;
  try {
    result = runInit(command.dir);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
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

/** Run the app with file-watch restarts until interrupted. Returns the exit code. */
const runDevCommand = async (command: Extract<Command, { kind: 'dev' }>): Promise<number> => {
  let entry: string;
  try {
    const { config } = await loadConfig(process.cwd());
    entry = resolveDevEntry(config, command.entry);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
  out(`sambar dev: running ${entry} (Ctrl-C to stop)`);
  await runDev(process.cwd(), entry, awaitInterrupt);
  return 0;
};

/** Execute a parsed {@link Command} and resolve to the process exit code. */
export const dispatch = async (command: Command, deps: DispatchDeps = {}): Promise<number> => {
  switch (command.kind) {
    case 'help':
      out(USAGE);
      return 0;
    case 'version':
      out(SAMBAR_VERSION);
      return 0;
    case 'init':
      return runInitCommand(command);
    case 'dev':
      return await runDevCommand(command);
    case 'run':
      return await runApp(command.entry, command.args);
    case 'build':
      return await runBuild(command, deps);
    case 'error':
      err(command.message);
      err('');
      err(USAGE);
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
