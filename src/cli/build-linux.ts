/**
 * No GTK/WebKitGTK libraries are bundled: Bunmaska dlopens the SYSTEM
 * GTK/WebKitGTK at runtime via bun:ffi. The output is an AppDir-style tree
 * packaged as a `.tar.gz` plus a `.deb`.
 */

import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { isSystemEngine, parseEngineId } from '../common/engine-id';
import { type Arch, currentArch, currentPlatform } from '../common/platform';
import { BUNMASKA_VERSION } from '../common/version';
import { bundlePreloadAssets, copyAppAssets } from './app-assets';
import { runTool } from './run-tool';
import { bundleIdSlug } from './build-macos';

export type LinuxLayout = {
  readonly appDir: string;
  readonly slug: string;
  readonly binPath: string;
  readonly desktopPath: string;
  readonly iconPath: string;
  /** The baked engine-id, read at launch (resolves `usr/bin/<slug>` -> here). */
  readonly engineIdPath: string;
};

/**
 * Compute every on-disk path of an `<out>/<Name>` AppDir-style tree. POSIX joins
 * keep the layout identical when computed on a cross-building host.
 */
export const linuxLayout = (out: string, name: string): LinuxLayout => {
  const { join } = posix;
  const slug = bundleIdSlug(name);
  const appDir = join(out, name);
  return {
    appDir,
    slug,
    binPath: join(appDir, 'usr', 'bin', slug),
    desktopPath: join(appDir, 'usr', 'share', 'applications', `${slug}.desktop`),
    iconPath: join(appDir, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps', `${slug}.png`),
    engineIdPath: join(appDir, 'usr', 'share', slug, 'engine.id'),
  };
};

/**
 * A full engine id verbatim, else the `system` sentinel. A bare upstream version
 * (e.g. `2.52.4`) downgrades to `system` — this path does not consult the engine
 * catalog yet, so the caller should surface the downgrade.
 */
export const resolveBuildEngineId = (webkitPin: string | undefined): string => {
  if (webkitPin === undefined || isSystemEngine(webkitPin)) {
    return 'system';
  }
  try {
    parseEngineId(webkitPin);
    return webkitPin;
  } catch {
    return 'system';
  }
};

/** Debian's label for the architecture: `amd64` for x64, `arm64` as is. */
export const debArch = (arch: Arch): 'amd64' | 'arm64' => (arch === 'x64' ? 'amd64' : 'arm64');

export const tarballName = (name: string, arch: Arch = currentArch()): string =>
  `${name}-linux-${arch}.tar.gz`;

export const debFileName = (name: string, version: string, arch: Arch = currentArch()): string =>
  `${bundleIdSlug(name)}_${version}_${debArch(arch)}.deb`;

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
  /** Runtime package dependencies (`Depends:`). Omitted from the field when empty. */
  readonly depends?: readonly string[];
};

/**
 * Runtime packages a non-embedded Bunmaska `.deb` needs: the system WebKitGTK 6.0
 * web view and its GTK 4 toolkit. Without this, an `apt install` on a minimal box
 * leaves the app to crash at the first `dlopen` (the latent bug this fixes). Debian
 * package names confirmed on sid: `libwebkitgtk-6.0-4`, `libgtk-4-1`.
 */
export const DEFAULT_LINUX_DEPENDS: readonly string[] = ['libwebkitgtk-6.0-4', 'libgtk-4-1'];

export const buildControlFile = (opts: ControlFileOptions): string =>
  [
    `Package: ${opts.slug}`,
    `Version: ${opts.version}`,
    `Architecture: ${opts.arch ?? debArch(currentArch())}`,
    `Maintainer: ${opts.maintainer}`,
    ...(opts.depends !== undefined && opts.depends.length > 0
      ? [`Depends: ${opts.depends.join(', ')}`]
      : []),
    `Description: ${opts.description}`,
    '',
  ].join('\n');

/** Pad a field to a fixed width for a GNU `ar` member header. */
const arField = (value: string, width: number): string => value.padEnd(width, ' ').slice(0, width);

/** Encode one GNU `ar` member: header + content, padded to an even byte length. */
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

/**
 * dpkg installs files with the archived owner and paths, so members must be
 * root-owned, xattr-free and without macOS bsdtar's AppleDouble `._*` twins
 * (which also collide across packages). The flags work in bsdtar and GNU tar.
 */
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
    'bun',
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
  /** Engine shipped inside the bundle — drops the system WebKitGTK `Depends:`. */
  readonly embedEngine?: boolean;
  /** The app's own version for the .deb; defaults to the framework version. */
  readonly version?: string;
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
  const maintainer = `${opts.id ?? `com.bunmaska.${layout.slug}`} <noreply@bunmaska.dev>`;
  const description = `${opts.name} built with Bunmaska`;

  mkdirSync(dirname(layout.binPath), { recursive: true });
  mkdirSync(dirname(layout.desktopPath), { recursive: true });

  const arch = opts.arch ?? currentArch();
  await compileLinuxBinary(opts.entry, layout.binPath, arch);
  chmodSync(layout.binPath, 0o755);

  // Bundle a module-using preload so it runs as a classic script in the packaged app.
  const assetsDir = dirname(layout.binPath);
  bundlePreloadAssets(opts.entry, assetsDir, copyAppAssets(opts.entry, assetsDir));
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

  // Bake the engine-id the app pins, read at launch by the engine resolver.
  mkdirSync(dirname(layout.engineIdPath), { recursive: true });
  writeFileSync(layout.engineIdPath, `${opts.engineId ?? 'system'}\n`);

  // -C keeps the archived paths relative to <out>.
  const tarball = join(out, tarballName(opts.name, arch));
  await tarGz(tarball, out, opts.name);

  // An embedded engine ships its own WebKitGTK, so it needs no system Depends.
  const depends = opts.embedEngine === true ? [] : DEFAULT_LINUX_DEPENDS;
  const deb = await packageDeb({
    layout,
    out,
    version: opts.version ?? BUNMASKA_VERSION,
    arch,
    name: opts.name,
    maintainer,
    description,
    depends,
  });

  return { appDir: layout.appDir, tarball, deb };
};

/**
 * A `.deb` is an `ar` archive of `debian-binary`, `control.tar.gz`, and
 * `data.tar.gz` (the `usr/` tree under the filesystem root), in that order.
 */
const packageDeb = async (args: {
  readonly layout: LinuxLayout;
  readonly out: string;
  readonly version: string;
  readonly arch: Arch;
  readonly name: string;
  readonly maintainer: string;
  readonly description: string;
  readonly depends: readonly string[];
}): Promise<string> => {
  const { layout, out, version, arch, name, maintainer, description, depends } = args;
  const staging = join(out, `.deb-${layout.slug}`);
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
      depends,
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
};
