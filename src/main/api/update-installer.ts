/**
 * The default `quitAndInstall` installer: a detached helper script waits for the
 * app to exit, extracts the staged tar into a TEMP SIBLING of the install root,
 * rename-swaps it into place (a half-extract can never brick the installed
 * app), relaunches, and deletes itself.
 */

import { chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createLogger } from '../../common/logger';
import type { ArtifactOs } from '../../common/manifest';
import { currentPlatform } from '../../common/platform';
import { app } from './app';
import type { StagedUpdate } from './auto-updater';

const log = createLogger('auto-updater');

/**
 * Where the running app is installed, derived from the executable path;
 * `undefined` means "not an installed bundle" (e.g. `bun main.ts`) and the
 * installer must refuse rather than swap a guessed directory.
 */
export const deriveInstallRoot = (execPath: string, os: ArtifactOs): string | undefined => {
  if (os === 'macos') {
    // build-macos layout: <Name>.app/Contents/MacOS/<Name>
    const macosDir = dirname(execPath);
    const contentsDir = dirname(macosDir);
    const appDir = dirname(contentsDir);
    if (
      basename(macosDir) !== 'MacOS' ||
      basename(contentsDir) !== 'Contents' ||
      !basename(appDir).endsWith('.app')
    ) {
      return undefined;
    }
    return appDir;
  }
  if (os === 'linux') {
    // build-linux layout: <AppDir>/usr/bin/<slug>; a system /usr/bin binary
    // would derive the filesystem root, which is never a swappable AppDir.
    const binDir = dirname(execPath);
    const usrDir = dirname(binDir);
    const rootDir = dirname(usrDir);
    if (basename(binDir) !== 'bin' || basename(usrDir) !== 'usr' || dirname(rootDir) === rootDir) {
      return undefined;
    }
    return rootDir;
  }
  // build-windows layout: the portable dir holds the exe; refuse a drive root.
  const rootDir = dirname(execPath);
  return dirname(rootDir) === rootDir ? undefined : rootDir;
};

/** Top-level dir inside the update tar; mirrors `bunmaska build`'s bundle names. */
export const stagedBundleDirName = (name: string, os: ArtifactOs): string =>
  os === 'macos' ? `${name}.app` : name;

/** Single-quote a string for /bin/sh; embedded quotes become `'\''`. */
export const shQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

export type ShInstallSpec = {
  readonly pid: number;
  readonly tarPath: string;
  readonly installRoot: string;
  /** Top-level directory name the tar extracts to (see {@link stagedBundleDirName}). */
  readonly bundleDirName: string;
  /** `open <root>` on macOS; the AppDir binary path on Linux. */
  readonly relaunchArgv: readonly string[];
};

/** Generate the POSIX helper: wait for the pid, extract, rename-swap, relaunch. */
export const buildShInstallScript = (spec: ShInstallSpec): string => {
  const root = shQuote(spec.installRoot);
  const staging = shQuote(`${spec.installRoot}.update-staging`);
  const old = shQuote(`${spec.installRoot}.update-old`);
  const fresh = shQuote(`${spec.installRoot}.update-staging/${spec.bundleDirName}`);
  const tar = shQuote(spec.tarPath);
  const relaunch = spec.relaunchArgv.map(shQuote).join(' ');
  return [
    '#!/bin/sh',
    '# bunmaska auto-update helper: waits for the app to exit, swaps, relaunches.',
    `while kill -0 ${spec.pid} 2>/dev/null; do sleep 0.5; done`,
    `rm -rf ${staging} ${old}`,
    `mkdir -p ${staging} || exit 1`,
    // A failed extract only dirties the staging dir; the installed app is untouched.
    `tar -xf ${tar} -C ${staging} || { rm -rf ${staging}; exit 1; }`,
    `[ -d ${fresh} ] || { rm -rf ${staging}; exit 1; }`,
    // The swap is two renames; a failed second rename rolls the first back.
    `mv ${root} ${old} || exit 1`,
    `mv ${fresh} ${root} || { mv ${old} ${root}; exit 1; }`,
    `rm -rf ${old} ${staging}`,
    `rm -f ${tar}`,
    `${relaunch} &`,
    'rm -f -- "$0"',
    '',
  ].join('\n');
};

export type CmdInstallSpec = {
  readonly pid: number;
  readonly tarPath: string;
  readonly installRoot: string;
  readonly bundleDirName: string;
  readonly exeName: string;
};

/** Generate the Windows cmd helper with the same wait-swap-start shape. */
export const buildCmdInstallScript = (spec: CmdInstallSpec): string => {
  const staging = `${spec.installRoot}.update-staging`;
  const old = `${spec.installRoot}.update-old`;
  return [
    '@echo off',
    'rem bunmaska auto-update helper: waits for the app to exit, swaps, relaunches.',
    ':wait',
    `tasklist /FI "PID eq ${spec.pid}" | find "${spec.pid}" >nul`,
    'if not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)',
    `if exist "${old}" rmdir /s /q "${old}"`,
    `if exist "${staging}" rmdir /s /q "${staging}"`,
    `mkdir "${staging}" || exit /b 1`,
    'rem extract from cwd, not tar -C: Windows bsdtar mangles backslash -C paths',
    `cd /d "${staging}" || exit /b 1`,
    `tar -xf "${spec.tarPath}" || exit /b 1`,
    'cd /d "%TEMP%"',
    `if not exist "${staging}\\${spec.bundleDirName}" exit /b 1`,
    `move "${spec.installRoot}" "${old}" || exit /b 1`,
    `move "${staging}\\${spec.bundleDirName}" "${spec.installRoot}" || (move "${old}" "${spec.installRoot}" & exit /b 1)`,
    `rmdir /s /q "${old}"`,
    `rmdir /s /q "${staging}"`,
    `del /q "${spec.tarPath}"`,
    `start "" "${spec.installRoot}\\${spec.exeName}"`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n');
};

export type InstallerDeps = {
  readonly execPath: () => string;
  readonly os: () => ArtifactOs;
  readonly pid: () => number;
  readonly writeScript: (path: string, text: string) => void;
  readonly spawnDetached: (argv: readonly string[]) => void;
  readonly quit: () => void;
};

/** Write + spawn the helper for a staged update, then quit; refuses un-bundled layouts. */
export const installStagedUpdate = (staged: StagedUpdate, deps: InstallerDeps): void => {
  const os = deps.os();
  const execPath = deps.execPath();
  const installRoot = deriveInstallRoot(execPath, os);
  if (installRoot === undefined) {
    log.warn(
      `autoUpdater.quitAndInstall: ${execPath} is not an installed ${os} bundle; ` +
        `refusing to swap (staged tar left at ${staged.tarPath})`,
    );
    deps.quit();
    return;
  }
  const bundleDirName = stagedBundleDirName(staged.manifest.name, os);
  const pid = deps.pid();
  if (os === 'windows') {
    const scriptPath = join(tmpdir(), `bunmaska-install-${staged.manifest.hash}.cmd`);
    deps.writeScript(
      scriptPath,
      buildCmdInstallScript({
        pid,
        tarPath: staged.tarPath,
        installRoot,
        bundleDirName,
        exeName: basename(execPath),
      }),
    );
    deps.spawnDetached(['cmd.exe', '/c', scriptPath]);
  } else {
    const scriptPath = join(tmpdir(), `bunmaska-install-${staged.manifest.hash}.sh`);
    const relaunchArgv = os === 'macos' ? ['open', installRoot] : [execPath];
    deps.writeScript(
      scriptPath,
      buildShInstallScript({
        pid,
        tarPath: staged.tarPath,
        installRoot,
        bundleDirName,
        relaunchArgv,
      }),
    );
    deps.spawnDetached(['/bin/sh', scriptPath]);
  }
  deps.quit();
};

const spawnDetachedScript = (argv: readonly string[]): void => {
  // unref so app.quit() is not held open; a POSIX orphan reparents and lives on.
  const proc = Bun.spawn([...argv], { stdio: ['ignore', 'ignore', 'ignore'] });
  proc.unref();
};

/** The production default installer behind `autoUpdater.quitAndInstall`. */
export const defaultInstall = (staged: StagedUpdate): void => {
  installStagedUpdate(staged, {
    execPath: () => process.execPath,
    os: currentPlatform,
    pid: () => process.pid,
    writeScript: (path, text) => {
      writeFileSync(path, text);
      chmodSync(path, 0o755);
    },
    spawnDetached: spawnDetachedScript,
    quit: () => app.quit(),
  });
};
