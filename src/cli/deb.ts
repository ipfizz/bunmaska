import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Arch, currentArch, currentPlatform } from '../common/platform';
import type { LinuxLayout } from './build-linux';
import { bundleIdSlug } from './build-macos';
import { runTool } from './run-tool';

/** Debian's label for the architecture: `amd64` for x64, `arm64` as is. */
export const debArch = (arch: Arch): 'amd64' | 'arm64' => (arch === 'x64' ? 'amd64' : 'arm64');

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
export const tarGz = (archive: string, dir: string, member: string): Promise<void> =>
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

/** dpkg requires the `ar` members in order: `debian-binary`, `control.tar.gz`, `data.tar.gz`. */
export const packageDeb = async (args: {
  readonly layout: Pick<LinuxLayout, 'appDir' | 'slug'>;
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
