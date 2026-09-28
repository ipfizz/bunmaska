import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { isSystemEngine, parseEngineId } from '../common/engine-id';
import { type Arch, currentArch, currentPlatform, type Platform } from '../common/platform';
import { BUNMASKA_VERSION } from '../common/version';
import { bundlePreloadAssets, copyAppAssets, writeAppManifest } from './app-assets';
import { runTool } from './run-tool';
import { bundleIdSlug } from './build-macos';

export type LinuxLayout = {
  readonly appDir: string;
  readonly slug: string;
  /** `usr/lib/<slug>/<slug>`: the binary and its assets share a directory no other package owns. */
  readonly binPath: string;
  /** `usr/bin/<slug>`, a relative link to {@link binPath}; the only file in the shared `usr/bin`. */
  readonly launcherPath: string;
  readonly desktopPath: string;
  readonly iconPath: string;
  readonly engineIdPath: string;
};

/** Paths of the `<out>/<Name>` AppDir tree; POSIX joins so any build host lays it out alike. */
export const linuxLayout = (out: string, name: string): LinuxLayout => {
  const { join } = posix;
  const slug = bundleIdSlug(name);
  const appDir = join(out, name);
  return {
    appDir,
    slug,
    binPath: join(appDir, 'usr', 'lib', slug, slug),
    launcherPath: join(appDir, 'usr', 'bin', slug),
    desktopPath: join(appDir, 'usr', 'share', 'applications', `${slug}.desktop`),
    iconPath: join(appDir, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps', `${slug}.png`),
    engineIdPath: join(appDir, 'usr', 'lib', slug, 'engine.id'),
  };
};

/** A full engine id built for `target` verbatim, else `system`; the caller warns about a downgrade. */
export const resolveBuildEngineId = (
  webkitPin: string | undefined,
  target: { readonly os: Platform; readonly arch: Arch },
): string => {
  if (webkitPin === undefined || isSystemEngine(webkitPin)) {
    return 'system';
  }
  try {
    const ref = parseEngineId(webkitPin);
    return ref.os === target.os && ref.arch === target.arch ? webkitPin : 'system';
  } catch {
    return 'system'; // ponytail: a bare version (`2.52.4`) lands here; resolve via the catalog
  }
};

/** Debian's label for the architecture: `amd64` for x64, `arm64` as is. */
export const debArch = (arch: Arch): 'amd64' | 'arm64' => (arch === 'x64' ? 'amd64' : 'arm64');

export const tarballName = (name: string, arch: Arch = currentArch()): string =>
  `${name}-linux-${arch}.tar.gz`;

// dpkg splits a revision at the last `-`, so `1.0.0-beta.1` sorts above `1.0.0`; `~` sorts below.
const debVersion = (version: string): string => version.replace('-', '~');

export const debFileName = (name: string, version: string, arch: Arch = currentArch()): string =>
  `${bundleIdSlug(name)}_${debVersion(version)}_${debArch(arch)}.deb`;

/** A Debian `Maintainer` from package.json's `author`; `undefined` without the required email. */
export const debMaintainer = (author: unknown): string | undefined => {
  if (typeof author === 'string') {
    const match = /^([^<(]*?)\s*<([^>]+)>/.exec(author.trim());
    return match === null ? undefined : `${match[1]} <${match[2]}>`;
  }
  if (typeof author === 'object' && author !== null) {
    const { name, email } = author as Record<string, unknown>;
    return typeof name === 'string' && typeof email === 'string' ? `${name} <${email}>` : undefined;
  }
  return undefined;
};

export type DesktopEntryOptions = {
  readonly name: string;
  readonly slug: string;
  readonly comment: string;
};

export const buildDesktopEntry = (opts: DesktopEntryOptions): string =>
  [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${opts.name}`,
    `Exec=${opts.slug}`,
    `Icon=${opts.slug}`,
    'Categories=Utility;',
    'Terminal=false',
    `Comment=${opts.comment}`,
    '',
  ].join('\n');

export type ControlFileOptions = {
  readonly slug: string;
  readonly version: string;
  /** Debian architecture label; defaults to the host's. */
  readonly arch?: 'amd64' | 'arm64';
  readonly maintainer: string;
  readonly description: string;
  /** `Depends:` packages; the field is omitted when empty. */
  readonly depends?: readonly string[];
};

/**
 * The system WebKitGTK 6.0 and GTK 4 the app dlopens; without them an `apt install`
 * on a minimal box crashes at the first `dlopen`. Names confirmed on Debian sid.
 */
export const DEFAULT_LINUX_DEPENDS: readonly string[] = ['libwebkitgtk-6.0-4', 'libgtk-4-1'];

export const buildControlFile = (opts: ControlFileOptions): string =>
  [
    `Package: ${opts.slug}`,
    `Version: ${debVersion(opts.version)}`,
    `Architecture: ${opts.arch ?? debArch(currentArch())}`,
    `Maintainer: ${opts.maintainer}`,
    ...(opts.depends !== undefined && opts.depends.length > 0
      ? [`Depends: ${opts.depends.join(', ')}`]
      : []),
    // Notifications dlopen libnotify.so.4; the app runs without it.
    'Recommends: libnotify4',
    `Description: ${opts.description}`,
    '',
  ].join('\n');

const arField = (value: string, width: number): string => value.padEnd(width, ' ').slice(0, width);

const arMember = (name: string, content: Uint8Array): Uint8Array => {
  const header =
    arField(name, 16) +
    arField('0', 12) + // mtime
    arField('0', 6) + // uid
    arField('0', 6) + // gid
    arField('100644', 8) + // mode
    arField(String(content.length), 10) + // size
    '`\n'; // two-byte member-header terminator
  const headerBytes = new TextEncoder().encode(header);
  // ar pads an odd-length member with one '\n' so the next header is even-aligned.
  const pad = content.length % 2 === 1 ? [Buffer.from('\n')] : [];
  return Buffer.concat([headerBytes, content, ...pad]);
};

export const buildArArchive = (
  members: readonly { name: string; content: Uint8Array }[],
): Uint8Array => {
  return Buffer.concat([
    new TextEncoder().encode('!<arch>\n'),
    ...members.map((m) => arMember(m.name, m.content)),
  ]);
};

// dpkg installs the archived owner and every path, so members must be root-owned, xattr-free
// and without macOS bsdtar's AppleDouble `._*` twins (they collide across packages).
// The flags work in bsdtar and GNU tar.
const tarGz = (archive: string, dir: string, member: string): Promise<void> =>
  runTool('tar', [
    ...(currentPlatform() === 'macos' ? ['env', 'COPYFILE_DISABLE=1'] : []),
    'tar',
    '--no-xattrs',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-czf',
    archive,
    '-C',
    dir,
    member,
  ]);

const compileLinuxBinary = async (entry: string, outfile: string, arch: Arch): Promise<void> => {
  await runTool('bun build --compile', [
    process.execPath,
    'build',
    entry,
    '--compile',
    `--target=bun-linux-${arch}`,
    '--outfile',
    outfile,
  ]);
};

export type BuildLinuxAppOptions = {
  /** A built renderer directory to ship as `renderer/` beside the executable. */
  readonly rendererDir?: string;
  readonly entry: string;
  readonly name: string;
  readonly id?: string;
  readonly out?: string;
  readonly icon?: string;
  /** Engine-id to bake (the per-app pin); `system` (the default) = OS WebView. */
  readonly engineId?: string;
  /** The app's own version for the .deb; defaults to the framework version. */
  readonly version?: string;
  /** The .deb `Maintainer`, `Name <email>`; defaults to one derived from the bundle id. */
  readonly maintainer?: string;
  /** Target architecture; defaults to the host's. */
  readonly arch?: Arch;
};

export type BuildLinuxAppResult = {
  readonly appDir: string;
  readonly tarball: string;
  readonly deb: string;
};

export const buildLinuxApp = async (opts: BuildLinuxAppOptions): Promise<BuildLinuxAppResult> => {
  const out = opts.out ?? process.cwd();
  const layout = linuxLayout(out, opts.name);
  if (layout.slug.length < 2) {
    throw new Error(
      `bunmaska build: a .deb package name needs at least 2 characters (got "${layout.slug}"); use a longer app name.`,
    );
  }
  const maintainer =
    opts.maintainer ?? `${opts.id ?? `com.bunmaska.${layout.slug}`} <noreply@bunmaska.dev>`;
  const description = `${opts.name} built with Bunmaska`;
  const version = opts.version ?? BUNMASKA_VERSION;

  // Start clean (everything the build writes is under usr/): cpSync merges into stale trees.
  rmSync(join(layout.appDir, 'usr'), { recursive: true, force: true });
  mkdirSync(dirname(layout.binPath), { recursive: true });
  mkdirSync(dirname(layout.launcherPath), { recursive: true });
  mkdirSync(dirname(layout.desktopPath), { recursive: true });

  const arch = opts.arch ?? currentArch();
  await compileLinuxBinary(opts.entry, layout.binPath, arch);
  chmodSync(layout.binPath, 0o755);
  symlinkSync(posix.join('..', 'lib', layout.slug, layout.slug), layout.launcherPath);

  const assetsDir = dirname(layout.binPath);
  bundlePreloadAssets(opts.entry, assetsDir, copyAppAssets(opts.entry, assetsDir));
  writeAppManifest(assetsDir, opts.name, version);
  if (opts.rendererDir !== undefined) {
    cpSync(opts.rendererDir, join(assetsDir, 'renderer'), { recursive: true });
  }

  writeFileSync(
    layout.desktopPath,
    buildDesktopEntry({ name: opts.name, slug: layout.slug, comment: description }),
  );

  if (opts.icon !== undefined) {
    if (!existsSync(opts.icon)) {
      throw new Error(`bunmaska build: icon not found: ${opts.icon}`);
    }
    mkdirSync(dirname(layout.iconPath), { recursive: true });
    copyFileSync(opts.icon, layout.iconPath);
  }

  writeFileSync(layout.engineIdPath, `${opts.engineId ?? 'system'}\n`);

  const tarball = join(out, tarballName(opts.name, arch));
  await tarGz(tarball, out, opts.name);

  const deb = await packageDeb({
    layout,
    out,
    version,
    arch,
    name: opts.name,
    maintainer,
    description,
  });

  return { appDir: layout.appDir, tarball, deb };
};

/** dpkg requires the `ar` members in order: `debian-binary`, `control.tar.gz`, `data.tar.gz`. */
const packageDeb = async (args: {
  readonly layout: LinuxLayout;
  readonly out: string;
  readonly version: string;
  readonly arch: Arch;
  readonly name: string;
  readonly maintainer: string;
  readonly description: string;
}): Promise<string> => {
  const { layout, out, version, arch, name, maintainer, description } = args;
  const staging = mkdtempSync(join(tmpdir(), 'bunmaska-deb-'));
  try {
    const controlDir = join(staging, 'control-root');
    mkdirSync(controlDir, { recursive: true });
    writeFileSync(
      join(controlDir, 'control'),
      buildControlFile({
        slug: layout.slug,
        version,
        arch: debArch(arch),
        maintainer,
        description,
        depends: DEFAULT_LINUX_DEPENDS,
      }),
    );

    const controlTar = join(staging, 'control.tar.gz');
    await tarGz(controlTar, controlDir, 'control');
    const dataTar = join(staging, 'data.tar.gz');
    await tarGz(dataTar, layout.appDir, 'usr');

    const debPath = join(out, debFileName(name, version, arch));
    const archive = buildArArchive([
      { name: 'debian-binary', content: new TextEncoder().encode('2.0\n') },
      { name: 'control.tar.gz', content: new Uint8Array(await Bun.file(controlTar).arrayBuffer()) },
      { name: 'data.tar.gz', content: new Uint8Array(await Bun.file(dataTar).arrayBuffer()) },
    ]);
    await Bun.write(debPath, archive);
    return debPath;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};
