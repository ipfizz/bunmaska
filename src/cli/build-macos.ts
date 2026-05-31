/**
 * macOS `.app` bundler for the `sambar` CLI.
 *
 * The app is compiled to a single self-contained executable with Bun's
 * `--compile`, which embeds the Bun runtime and the app's JS. No WebKit/AppKit
 * framework is bundled: Sambar dlopens the SYSTEM WebKit/AppKit at runtime via
 * bun:ffi, and those frameworks are always present on the user's Mac. The pure
 * parts (plist text, slug, bundle layout) are factored out for unit testing.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMBAR_VERSION } from '../common/version';

/** Minimum macOS the bundle declares it supports. */
const MINIMUM_SYSTEM_VERSION = '11.0';

/** Escape the five XML-special characters for safe inclusion in plist text. */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Reduce a display name to a DNS-label-ish slug for a default bundle id:
 * lowercase, non-alphanumeric runs collapsed to single hyphens, edges trimmed.
 * Falls back to `app` when nothing survives.
 */
export const bundleIdSlug = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'app';
};

/** The default `com.sambar.<slug>` bundle identifier for a given app name. */
export const defaultBundleId = (name: string): string => `com.sambar.${bundleIdSlug(name)}`;

export type InfoPlistOptions = {
  readonly name: string;
  readonly bundleId: string;
  readonly version: string;
  readonly iconFile?: string;
};

const plistString = (key: string, value: string): string =>
  `  <key>${key}</key>\n  <string>${escapeXml(value)}</string>`;

/** Build the `Info.plist` XML for a bundle. Pure; the icon key is omitted when absent. */
export const buildInfoPlist = (opts: InfoPlistOptions): string => {
  const entries = [
    plistString('CFBundleName', opts.name),
    plistString('CFBundleDisplayName', opts.name),
    plistString('CFBundleIdentifier', opts.bundleId),
    plistString('CFBundleExecutable', opts.name),
    plistString('CFBundlePackageType', 'APPL'),
    plistString('CFBundleInfoDictionaryVersion', '6.0'),
    plistString('CFBundleShortVersionString', opts.version),
    plistString('CFBundleVersion', opts.version),
    plistString('LSMinimumSystemVersion', MINIMUM_SYSTEM_VERSION),
    '  <key>NSHighResolutionCapable</key>\n  <true/>',
  ];
  if (opts.iconFile !== undefined) {
    entries.push(plistString('CFBundleIconFile', opts.iconFile));
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entries,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
};

export type AppBundleLayout = {
  readonly appDir: string;
  readonly contentsDir: string;
  readonly macosDir: string;
  readonly resourcesDir: string;
  readonly executablePath: string;
  readonly infoPlistPath: string;
  readonly iconFileName: string;
  readonly iconPath: string;
};

/** Compute every on-disk path of an `<out>/<Name>.app` bundle. Pure. */
export const appBundleLayout = (out: string, name: string): AppBundleLayout => {
  const appDir = join(out, `${name}.app`);
  const contentsDir = join(appDir, 'Contents');
  const macosDir = join(contentsDir, 'MacOS');
  const resourcesDir = join(contentsDir, 'Resources');
  const iconFileName = `${name}.icns`;
  return {
    appDir,
    contentsDir,
    macosDir,
    resourcesDir,
    executablePath: join(macosDir, name),
    infoPlistPath: join(contentsDir, 'Info.plist'),
    iconFileName,
    iconPath: join(resourcesDir, iconFileName),
  };
};

export type BuildMacAppOptions = {
  readonly entry: string;
  readonly name: string;
  readonly id?: string;
  readonly out?: string;
  readonly icon?: string;
};

/** Compile `entry` to a standalone binary at `outfile`. Throws on a non-zero exit. */
const compileBinary = async (entry: string, outfile: string): Promise<void> => {
  const proc = Bun.spawn(['bun', 'build', entry, '--compile', '--outfile', outfile], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`bun build --compile failed (exit ${exitCode}):\n${stderr}`);
  }
};

/**
 * Produce a macOS `.app` bundle for `entry` and return the bundle's path.
 * Compiles the entry with Bun, lays out `Contents/`, writes `Info.plist`,
 * installs the binary as the executable, and copies the icon when given.
 */
export const buildMacApp = async (opts: BuildMacAppOptions): Promise<string> => {
  const out = opts.out ?? process.cwd();
  const bundleId = opts.id ?? defaultBundleId(opts.name);
  const layout = appBundleLayout(out, opts.name);

  mkdirSync(layout.macosDir, { recursive: true });
  mkdirSync(layout.resourcesDir, { recursive: true });

  // Compile straight into the bundle's executable slot.
  await compileBinary(opts.entry, layout.executablePath);
  chmodSync(layout.executablePath, 0o755);

  let iconFile: string | undefined;
  if (opts.icon !== undefined) {
    if (!existsSync(opts.icon)) {
      throw new Error(`sambar build: icon not found: ${opts.icon}`);
    }
    copyFileSync(opts.icon, layout.iconPath);
    iconFile = layout.iconFileName;
  }

  const plist = buildInfoPlist(
    iconFile === undefined
      ? { name: opts.name, bundleId, version: SAMBAR_VERSION }
      : { name: opts.name, bundleId, version: SAMBAR_VERSION, iconFile },
  );
  writeFileSync(layout.infoPlistPath, plist);

  return layout.appDir;
};
