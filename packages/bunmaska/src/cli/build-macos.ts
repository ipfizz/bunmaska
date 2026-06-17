/**
 * macOS `.app` bundler for the `bunmaska` CLI.
 *
 * The app is compiled to a single self-contained executable with Bun's
 * `--compile`, which embeds the Bun runtime and the app's JS. No WebKit/AppKit
 * framework is bundled: Bunmaska dlopens the SYSTEM WebKit/AppKit at runtime via
 * bun:ffi, and those frameworks are always present on the user's Mac. The pure
 * parts (plist text, slug, bundle layout) are factored out for unit testing.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNMASKA_VERSION } from '../common/version';

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

/** The default `com.bunmaska.<slug>` bundle identifier for a given app name. */
export const defaultBundleId = (name: string): string => `com.bunmaska.${bundleIdSlug(name)}`;

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

/**
 * Build the `codesign` argv that signs an `.app` bundle in place. Pure.
 *
 * Uses `--force --deep` so an existing signature is replaced and nested code is
 * signed, and `--options runtime` to opt the bundle into the macOS Hardened
 * Runtime (required for notarization). `identity` is passed verbatim after
 * `--sign`: a real `Developer ID Application: …` identity (which must be present
 * in the keychain) or `-` for an ad-hoc signature that needs no certificate.
 */
export const buildCodesignArgs = (identity: string, appPath: string): string[] => [
  '--force',
  '--deep',
  '--options',
  'runtime',
  '--sign',
  identity,
  appPath,
];

/** Build the `codesign --verify --strict` argv for an `.app` bundle. Pure. */
export const buildCodesignVerifyArgs = (appPath: string): string[] => [
  '--verify',
  '--strict',
  appPath,
];

export type NotarizeOptions = {
  readonly appPath: string;
  readonly appleId: string;
  readonly teamId: string;
  readonly password: string;
};

/**
 * Build the `xcrun notarytool submit …` argv for an `.app` bundle. Pure.
 *
 * This is a documented HOOK for a real release: it is NOT invoked by the build
 * (it needs Apple credentials and network). `password` is an app-specific
 * password for the Apple ID. `--wait` blocks until Apple finishes processing.
 */
export const buildNotarizeArgs = (opts: NotarizeOptions): string[] => [
  'xcrun',
  'notarytool',
  'submit',
  opts.appPath,
  '--apple-id',
  opts.appleId,
  '--team-id',
  opts.teamId,
  '--password',
  opts.password,
  '--wait',
];

/**
 * Build the `xcrun stapler staple …` argv for an `.app` bundle. Pure.
 *
 * Also a documented HOOK: stapling attaches the notarization ticket to the
 * bundle and is only meaningful after a successful notarytool submission.
 */
export const buildStapleArgs = (appPath: string): string[] => [
  'xcrun',
  'stapler',
  'staple',
  appPath,
];

/** One entry of a macOS `.iconset`: the file name and the square pixel size. */
export type IconsetEntry = {
  readonly name: string;
  readonly size: number;
};

/**
 * The ten standard `.iconset` members macOS expects, in ascending order. Each
 * `@2x` retina variant is exactly double its non-retina sibling. Pure. Used to
 * drive the `sips` resizes that feed `iconutil`.
 */
export const iconsetSpec = (): readonly IconsetEntry[] => [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

/** Build the `sips` argv that resizes `src` to a `size`×`size` square at `dest`. Pure. */
export const buildSipsArgs = (size: number, src: string, dest: string): string[] => [
  '-z',
  String(size),
  String(size),
  src,
  '--out',
  dest,
];

/** Build the `iconutil` argv that converts an `.iconset` directory into `outIcns`. Pure. */
export const buildIconutilArgs = (iconsetDir: string, outIcns: string): string[] => [
  '-c',
  'icns',
  iconsetDir,
  '-o',
  outIcns,
];

export type HdiutilOptions = {
  readonly volName: string;
  readonly srcFolder: string;
  readonly outDmg: string;
};

/**
 * Build the `hdiutil create` argv for a compressed (`UDZO`) disk image. Pure.
 * `-ov` overwrites an existing image so repeat builds are idempotent.
 */
export const buildHdiutilArgs = (opts: HdiutilOptions): string[] => [
  'create',
  '-volname',
  opts.volName,
  '-srcfolder',
  opts.srcFolder,
  '-ov',
  '-format',
  'UDZO',
  opts.outDmg,
];

/** Spawn a tool, await it, and throw with its stderr on a non-zero exit. */
const runTool = async (label: string, argv: string[]): Promise<void> => {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${label} failed (exit ${exitCode}):\n${stderr}`);
  }
};

/**
 * Convert a PNG at `pngPath` to an `.icns` at `outIcns` via `sips` + `iconutil`.
 * Builds a temporary `.iconset` with the ten {@link iconsetSpec} sizes, then
 * folds it into a single `.icns`. Cleans the temp iconset on success or failure.
 */
export const convertPngToIcns = async (pngPath: string, outIcns: string): Promise<void> => {
  const work = mkdtempSync(join(tmpdir(), 'bunmaska-iconset-'));
  // iconutil only accepts a directory whose name ends in `.iconset`.
  const iconsetDir = join(work, 'icon.iconset');
  mkdirSync(iconsetDir, { recursive: true });
  try {
    for (const { name, size } of iconsetSpec()) {
      await runTool('sips', ['sips', ...buildSipsArgs(size, pngPath, join(iconsetDir, name))]);
    }
    await runTool('iconutil', ['iconutil', ...buildIconutilArgs(iconsetDir, outIcns)]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

/** Converts a PNG icon to `.icns`. Injectable so unit tests need not shell out. */
export type ConvertIcon = (pngPath: string, outIcns: string) => Promise<void>;

export type BuildDmgOptions = {
  readonly appDir: string;
  readonly name: string;
  readonly outDmg: string;
};

/**
 * Produce a compressed `.dmg` at `outDmg` containing the `.app` at `appDir`.
 * Stages the bundle plus a `/Applications` symlink (for drag-install) in a temp
 * folder, runs `hdiutil create`, and cleans the staging dir afterward. Throws
 * with the tool's stderr on a non-zero exit.
 */
export const buildDmg = async (opts: BuildDmgOptions): Promise<void> => {
  const staging = mkdtempSync(join(tmpdir(), 'bunmaska-dmg-'));
  try {
    const stagedApp = join(staging, `${opts.name}.app`);
    await runTool('cp', ['cp', '-R', opts.appDir, stagedApp]);
    await runTool('ln', ['ln', '-s', '/Applications', join(staging, 'Applications')]);
    await runTool('hdiutil', [
      'hdiutil',
      ...buildHdiutilArgs({ volName: opts.name, srcFolder: staging, outDmg: opts.outDmg }),
    ]);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};

/** Builds a `.dmg` from a finished `.app`. Injectable so unit tests need not shell out. */
export type BuildDmg = (opts: BuildDmgOptions) => Promise<void>;

/**
 * Code-sign an `.app` at `appPath` with `identity` (a real `Developer ID
 * Application: …` identity, or `-` for ad-hoc) and verify the result. Throws
 * with the tool's stderr on a non-zero exit from either step.
 */
export const codesignApp = async (identity: string, appPath: string): Promise<void> => {
  const sign = Bun.spawn(['codesign', ...buildCodesignArgs(identity, appPath)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const signExit = await sign.exited;
  if (signExit !== 0) {
    const stderr = await new Response(sign.stderr).text();
    throw new Error(`codesign failed (exit ${signExit}):\n${stderr}`);
  }

  const verify = Bun.spawn(['codesign', ...buildCodesignVerifyArgs(appPath)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const verifyExit = await verify.exited;
  if (verifyExit !== 0) {
    const stderr = await new Response(verify.stderr).text();
    throw new Error(`codesign --verify failed (exit ${verifyExit}):\n${stderr}`);
  }
};

/** Signs an `.app` bundle in place. Injectable so unit tests need not shell out. */
export type SignApp = (identity: string, appPath: string) => Promise<void>;

export type BuildMacAppOptions = {
  readonly entry: string;
  readonly name: string;
  readonly id?: string;
  readonly out?: string;
  /** App icon: a `.icns` (copied as-is) or a `.png` (converted to `.icns`). */
  readonly icon?: string;
  /** When set, code-sign the finished bundle with this identity (`-` = ad-hoc). */
  readonly sign?: string;
  /** When true, also produce an `<out>/<Name>.dmg` containing the signed bundle. */
  readonly dmg?: boolean;
  /** Seam for the signer; defaults to {@link codesignApp}. Stub it in tests. */
  readonly signApp?: SignApp;
  /** Seam for PNG→.icns conversion; defaults to {@link convertPngToIcns}. Stub it in tests. */
  readonly convertIcon?: ConvertIcon;
  /** Seam for `.dmg` creation; defaults to {@link buildDmg}. Stub it in tests. */
  readonly buildDmg?: BuildDmg;
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
      throw new Error(`bunmaska build: icon not found: ${opts.icon}`);
    }
    if (opts.icon.toLowerCase().endsWith('.png')) {
      // Convert the PNG to a multi-resolution .icns inside the bundle.
      const convertIcon = opts.convertIcon ?? convertPngToIcns;
      await convertIcon(opts.icon, layout.iconPath);
    } else {
      // Already an .icns (or another container iconutil produced): copy as-is.
      copyFileSync(opts.icon, layout.iconPath);
    }
    // CFBundleIconFile is the base name WITHOUT extension, per macOS convention.
    iconFile = opts.name;
  }

  const plist = buildInfoPlist(
    iconFile === undefined
      ? { name: opts.name, bundleId, version: BUNMASKA_VERSION }
      : { name: opts.name, bundleId, version: BUNMASKA_VERSION, iconFile },
  );
  writeFileSync(layout.infoPlistPath, plist);

  // Sign last, once the bundle (binary + Info.plist + resources) is fully laid
  // out, so the signature covers the final contents.
  if (opts.sign !== undefined) {
    const signApp = opts.signApp ?? codesignApp;
    await signApp(opts.sign, layout.appDir);
  }

  // The .dmg packages the finished (and signed, if requested) bundle, so it is
  // produced after signing.
  if (opts.dmg === true) {
    const dmg = opts.buildDmg ?? buildDmg;
    await dmg({ appDir: layout.appDir, name: opts.name, outDmg: join(out, `${opts.name}.dmg`) });
  }

  return layout.appDir;
};
