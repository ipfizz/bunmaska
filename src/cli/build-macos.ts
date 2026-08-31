/**
 * No WebKit/AppKit framework is bundled: Bunmaska dlopens the SYSTEM
 * frameworks at runtime via bun:ffi.
 */

import {
  cpSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { BUNMASKA_VERSION } from '../common/version';
import { bundlePreloadAssets, copyAppAssets } from './app-assets';

const MINIMUM_SYSTEM_VERSION = '11.0';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Lowercase DNS-label-ish slug; falls back to `app` when nothing survives. */
export const bundleIdSlug = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'app';
};

export const defaultBundleId = (name: string): string => `com.bunmaska.${bundleIdSlug(name)}`;

export type InfoPlistOptions = {
  readonly name: string;
  readonly bundleId: string;
  readonly version: string;
  readonly iconFile?: string;
};

const plistString = (key: string, value: string): string =>
  `  <key>${key}</key>\n  <string>${escapeXml(value)}</string>`;

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

/**
 * Compute every on-disk path of an `<out>/<Name>.app` bundle. POSIX joins keep
 * the layout identical when computed on a cross-building host.
 */
export const appBundleLayout = (out: string, name: string): AppBundleLayout => {
  const { join } = posix;
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
 * Entitlements a Bun-compiled app needs under the Hardened Runtime: JIT and
 * unsigned executable memory for JavaScriptCore and bun:ffi, and library
 * validation disabled so the app can dlopen the system WebKit/AppKit at launch.
 * Without these a hardened-runtime app traps (SIGTRAP) on its first FFI call.
 */
export const codesignEntitlements = (): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
`;

/**
 * `--options runtime` is required for notarization. `identity` is a real
 * `Developer ID Application: …` identity, or `-` for an ad-hoc signature.
 */
export const buildCodesignArgs = (
  identity: string,
  appPath: string,
  entitlementsPath: string,
): string[] => [
  '--force',
  '--deep',
  '--options',
  'runtime',
  '--entitlements',
  entitlementsPath,
  '--sign',
  identity,
  appPath,
];

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
 * Build the `xcrun notarytool submit …` argv. Pure.
 *
 * The default `--notarize` hook submits the ditto ZIP of the bundle (notarytool
 * refuses a bare `.app`), so `appPath` is the submit target, not always an app.
 * `password` is an app-specific password for the Apple ID. `--wait` blocks
 * until Apple finishes processing.
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
 * Stapling attaches the notarization ticket to the bundle and is only
 * meaningful after a successful notarytool submission.
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

/** The ten `.iconset` members macOS requires; each `@2x` is double its sibling. */
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

export const buildSipsArgs = (size: number, src: string, dest: string): string[] => [
  '-z',
  String(size),
  String(size),
  src,
  '--out',
  dest,
];

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

/** `-ov` overwrites an existing image so repeat builds are idempotent. */
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

/** Spawn a build tool and throw (with its stderr) on a non-zero exit. */
export const runTool = async (label: string, argv: string[]): Promise<void> => {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${label} failed (exit ${exitCode}):\n${stderr}`);
  }
};

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

export type ConvertIcon = (pngPath: string, outIcns: string) => Promise<void>;

export type BuildDmgOptions = {
  readonly appDir: string;
  readonly name: string;
  readonly outDmg: string;
};

/** Stages the bundle plus an `/Applications` symlink so the `.dmg` drag-installs. */
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

export type BuildDmg = (opts: BuildDmgOptions) => Promise<void>;

export const codesignApp = async (identity: string, appPath: string): Promise<void> => {
  const entitlementsDir = mkdtempSync(join(tmpdir(), 'bunmaska-entitlements-'));
  const entitlementsPath = join(entitlementsDir, 'app.entitlements');
  writeFileSync(entitlementsPath, codesignEntitlements());

  try {
    const sign = Bun.spawn(
      ['codesign', ...buildCodesignArgs(identity, appPath, entitlementsPath)],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
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
  } finally {
    rmSync(entitlementsDir, { recursive: true, force: true });
  }
};

export type SignApp = (identity: string, appPath: string) => Promise<void>;

export type BuildMacAppOptions = {
  /** A built renderer directory to ship as `renderer/` beside the executable. */
  readonly rendererDir?: string;
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
  readonly signApp?: SignApp;
  readonly convertIcon?: ConvertIcon;
  readonly buildDmg?: BuildDmg;
};

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

export const buildMacApp = async (opts: BuildMacAppOptions): Promise<string> => {
  const out = opts.out ?? process.cwd();
  const bundleId = opts.id ?? defaultBundleId(opts.name);
  const layout = appBundleLayout(out, opts.name);

  mkdirSync(layout.macosDir, { recursive: true });
  mkdirSync(layout.resourcesDir, { recursive: true });

  await compileBinary(opts.entry, layout.executablePath);
  chmodSync(layout.executablePath, 0o755);

  // Bundle a module-using preload so it runs as a classic script in the packaged app.
  bundlePreloadAssets(layout.macosDir, copyAppAssets(opts.entry, layout.macosDir));
  if (opts.rendererDir !== undefined) {
    cpSync(opts.rendererDir, join(layout.macosDir, 'renderer'), { recursive: true });
  }

  let iconFile: string | undefined;
  if (opts.icon !== undefined) {
    if (!existsSync(opts.icon)) {
      throw new Error(`bunmaska build: icon not found: ${opts.icon}`);
    }
    if (opts.icon.toLowerCase().endsWith('.png')) {
      const convertIcon = opts.convertIcon ?? convertPngToIcns;
      await convertIcon(opts.icon, layout.iconPath);
    } else {
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

  // The .dmg packages the signed bundle, so it is produced after signing.
  if (opts.dmg === true) {
    const dmg = opts.buildDmg ?? buildDmg;
    await dmg({ appDir: layout.appDir, name: opts.name, outDmg: join(out, `${opts.name}.dmg`) });
  }

  return layout.appDir;
};
