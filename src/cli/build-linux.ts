/**
 * Linux distributable builder for the `bunmaska` CLI.
 *
 * The app is cross/native compiled to a single self-contained executable with
 * Bun's `--compile --target=bun-linux-x64`, which embeds the Bun runtime and the
 * app's JS into a Linux ELF (this works even from a macOS host). No GTK/WebKitGTK
 * libraries are bundled: Bunmaska dlopens the SYSTEM GTK/WebKitGTK at runtime via
 * bun:ffi on the user's Linux box. The output is an AppDir-style tree packaged as
 * a `.tar.gz` plus a `.deb`. The pure parts (layout paths, .desktop text, control
 * text, archive names) are factored out for unit testing.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { isSystemEngine, parseEngineId } from '../common/engine-id';
import { BUNMASKA_VERSION } from '../common/version';
import { bundlePreloadAssets, copyAppAssets } from './app-assets';
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
 * Compute every on-disk path of an `<out>/<Name>` AppDir-style tree. Pure. Joins
 * with POSIX separators — an AppDir is an inherently Linux (POSIX) layout — so the
 * structure is identical whether computed on Linux or a cross-building host.
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
 * The engine-id to bake from a project's `engine.webkit` pin: a full id verbatim,
 * else the `system` sentinel. A bare upstream version (e.g. `2.52.4`) downgrades
 * to `system` for now — resolving it to a full id needs the engine catalog (a
 * follow-up); the caller should surface that.
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

/** File name of the `.tar.gz` distributable for an app. Pure. */
export const tarballName = (name: string): string => `${name}-linux-x64.tar.gz`;

/** File name of the Debian `.deb` package for an app. Pure. */
export const debFileName = (name: string, version: string): string =>
  `${bundleIdSlug(name)}_${version}_amd64.deb`;

export type DesktopEntryOptions = {
  readonly name: string;
  readonly slug: string;
  readonly comment: string;
};

/** Build the freedesktop `.desktop` entry text. Pure. */
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

/** Build the Debian `control` file text. Pure. */
export const buildControlFile = (opts: ControlFileOptions): string =>
  [
    `Package: ${opts.slug}`,
    `Version: ${opts.version}`,
    'Architecture: amd64',
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
  const needsPad = content.length % 2 === 1;
  const out = new Uint8Array(headerBytes.length + content.length + (needsPad ? 1 : 0));
  out.set(headerBytes, 0);
  out.set(content, headerBytes.length);
  if (needsPad) {
    out[headerBytes.length + content.length] = 0x0a; // '\n'
  }
  return out;
};

/** Concatenate the `ar` magic and members into a `.deb` (`ar`) archive. Pure. */
export const buildArArchive = (
  members: readonly { name: string; content: Uint8Array }[],
): Uint8Array => {
  const parts = [
    new TextEncoder().encode('!<arch>\n'),
    ...members.map((m) => arMember(m.name, m.content)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** Run a command, throwing with stderr on a non-zero exit. */
const spawnOk = async (cmd: readonly string[], cwd?: string): Promise<void> => {
  const proc = Bun.spawn(cmd as string[], {
    ...(cwd !== undefined ? { cwd } : {}),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${cmd[0]} failed (exit ${exitCode}):\n${stderr}`);
  }
};

/** Cross/native compile `entry` to a Linux ELF at `outfile`. Throws on failure. */
const compileLinuxBinary = async (entry: string, outfile: string): Promise<void> => {
  await spawnOk([
    'bun',
    'build',
    entry,
    '--compile',
    '--target=bun-linux-x64',
    '--outfile',
    outfile,
  ]);
};

export type BuildLinuxAppOptions = {
  readonly entry: string;
  readonly name: string;
  readonly id?: string;
  readonly out?: string;
  readonly icon?: string;
  /** Engine-id to bake (the per-app pin); `system` (the default) = OS WebView. */
  readonly engineId?: string;
  /** Engine shipped inside the bundle — drops the system WebKitGTK `Depends:`. */
  readonly embedEngine?: boolean;
};

export type BuildLinuxAppResult = {
  readonly appDir: string;
  readonly tarball: string;
  readonly deb: string;
};

/**
 * Produce the Linux distributables for `entry`: an AppDir-style tree, a
 * `.tar.gz` of it, and a `.deb`. Returns the produced paths.
 */
export const buildLinuxApp = async (opts: BuildLinuxAppOptions): Promise<BuildLinuxAppResult> => {
  const out = opts.out ?? process.cwd();
  const layout = linuxLayout(out, opts.name);
  const maintainer = `${opts.id ?? `com.bunmaska.${layout.slug}`} <noreply@bunmaska.dev>`;
  const description = `${opts.name} built with Bunmaska`;

  mkdirSync(dirname(layout.binPath), { recursive: true });
  mkdirSync(dirname(layout.desktopPath), { recursive: true });

  await compileLinuxBinary(opts.entry, layout.binPath);
  chmodSync(layout.binPath, 0o755);

  // Ship the entry's runtime assets (the page, the preload) beside the binary, then
  // bundle a module-using preload so it runs as a classic script in the packaged app.
  const assetsDir = dirname(layout.binPath);
  bundlePreloadAssets(assetsDir, copyAppAssets(opts.entry, assetsDir));

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

  // .tar.gz of the AppDir (use the system tar; -C keeps paths relative).
  const tarball = join(out, tarballName(opts.name));
  await spawnOk(['tar', '-czf', tarball, '-C', out, opts.name]);

  // An embedded engine ships its own WebKitGTK; otherwise the app needs the
  // system WebKitGTK + GTK (this Depends line is the fix for the latent crash).
  const depends = opts.embedEngine === true ? [] : DEFAULT_LINUX_DEPENDS;
  const deb = await packageDeb({
    layout,
    out,
    version: BUNMASKA_VERSION,
    name: opts.name,
    maintainer,
    description,
    depends,
  });

  return { appDir: layout.appDir, tarball, deb };
};

/**
 * Package the AppDir into a Debian `.deb`: an `ar` archive of `debian-binary`,
 * `control.tar.gz` (a `control` file), and `data.tar.gz` (the `usr/` tree under
 * the filesystem root). The inner tarballs use the system `tar`; the outer `ar`
 * container is written in pure JS.
 */
const packageDeb = async (args: {
  readonly layout: LinuxLayout;
  readonly out: string;
  readonly version: string;
  readonly name: string;
  readonly maintainer: string;
  readonly description: string;
  readonly depends: readonly string[];
}): Promise<string> => {
  const { layout, out, version, name, maintainer, description, depends } = args;
  const staging = join(out, `.deb-${layout.slug}`);
  const controlDir = join(staging, 'control-root');
  mkdirSync(controlDir, { recursive: true });

  writeFileSync(
    join(controlDir, 'control'),
    buildControlFile({ slug: layout.slug, version, maintainer, description, depends }),
  );

  const controlTar = join(staging, 'control.tar.gz');
  await spawnOk(['tar', '-czf', controlTar, '-C', controlDir, 'control']);

  const dataTar = join(staging, 'data.tar.gz');
  await spawnOk(['tar', '-czf', dataTar, '-C', layout.appDir, 'usr']);

  const debPath = join(out, debFileName(name, version));
  const archive = buildArArchive([
    { name: 'debian-binary', content: new TextEncoder().encode('2.0\n') },
    { name: 'control.tar.gz', content: new Uint8Array(await Bun.file(controlTar).arrayBuffer()) },
    { name: 'data.tar.gz', content: new Uint8Array(await Bun.file(dataTar).arrayBuffer()) },
  ]);
  await Bun.write(debPath, archive);

  return debPath;
};
