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
import { runTool } from './run-tool';

// The minos `bun build --compile` stamps into the Mach-O (Bun 1.4.2).
const MINIMUM_SYSTEM_VERSION = '13.0';

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

/**
 * Info.plist and a Windows VERSIONINFO accept only numeric `major.minor.patch`:
 * `0.1.0-alpha.2+b5` -> `0.1.0`, `1.2` -> `1.2.0`, a non-numeric segment -> `0`.
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
    plistString('CFBundleShortVersionString', numericVersion(opts.version)),
    plistString('CFBundleVersion', numericVersion(opts.version)),
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
 * `allow-jit` is mandatory: without it a hardened app throws "bun:ffi requires the JIT"
 * (Bun 1.4.2); the system WebKit/AppKit load with it alone. `disable-library-validation`
 * lets the app dlopen dylibs its team did not sign (user native modules).
 * ponytail: the two extra grants ship by default; make them config opt-ins
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

/** `--options runtime` (the hardened runtime) is required for notarization; `-` signs ad hoc. */
export const buildCodesignArgs = (
  identity: string,
  appPath: string,
  entitlementsPath: string,
): string[] => [
  '--force',
  '--deep',
  '--options',
  'runtime',
  // Notarization rejects a signature without a secure timestamp; ad-hoc cannot have one.
  ...(identity === '-' ? [] : ['--timestamp']),
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

/** `appPath` is the zip notarize.ts submits; `password` is an app-specific password. */
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
    await runTool('codesign', [
      'codesign',
      ...buildCodesignArgs(identity, appPath, entitlementsPath),
    ]);
    await runTool('codesign --verify', ['codesign', ...buildCodesignVerifyArgs(appPath)]);
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
  /** Notarize and staple the signed bundle; runs before the `.dmg` is built. */
  readonly notarize?: (appPath: string) => Promise<void>;
  /** The app's own version for Info.plist; defaults to the framework version. */
  readonly version?: string;
};

const compileBinary = (entry: string, outfile: string): Promise<void> =>
  runTool('bun build --compile', [
    process.execPath,
    'build',
    entry,
    '--compile',
    '--outfile',
    outfile,
  ]);

export const buildMacApp = async (opts: BuildMacAppOptions): Promise<string> => {
  const out = opts.out ?? process.cwd();
  const bundleId = opts.id ?? defaultBundleId(opts.name);
  const version = opts.version ?? BUNMASKA_VERSION;
  const layout = appBundleLayout(out, opts.name);

  // Start clean: cpSync merges, so files an earlier build shipped would ship again.
  rmSync(layout.appDir, { recursive: true, force: true });
  mkdirSync(layout.macosDir, { recursive: true });
  mkdirSync(layout.resourcesDir, { recursive: true });

  await compileBinary(opts.entry, layout.executablePath);
  chmodSync(layout.executablePath, 0o755);

  bundlePreloadAssets(opts.entry, layout.macosDir, copyAppAssets(opts.entry, layout.macosDir));
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
      ? { name: opts.name, bundleId, version }
      : { name: opts.name, bundleId, version, iconFile },
  );
  writeFileSync(layout.infoPlistPath, plist);

  // Sign last so the seal covers the final bundle.
  if (opts.sign !== undefined) {
    const signApp = opts.signApp ?? codesignApp;
    await signApp(opts.sign, layout.appDir);
  }
  if (opts.notarize !== undefined) {
    await opts.notarize(layout.appDir);
  }

  // The .dmg packages the final bundle, so it comes after signing and stapling.
  if (opts.dmg === true) {
    const dmg = opts.buildDmg ?? buildDmg;
    await dmg({ appDir: layout.appDir, name: opts.name, outDmg: join(out, `${opts.name}.dmg`) });
  }

  return layout.appDir;
};
