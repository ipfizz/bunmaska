/**
 * The distributable artifact naming + update-manifest contract.
 *
 * This is the single source of truth shared by the `bunmaska build` packager
 * (which *writes* `version.json` next to each artifact) and the runtime
 * `autoUpdater` (which *reads* a channel feed's `update.json` to decide whether
 * a newer build is available). The flat `name-channel-os-arch` artifact naming
 * and the wyhash content hash mirror Electrobun's `naming.ts`, adapted to pure
 * Bun — no compiled code.
 */

import type { Arch } from './platform';

/** A release channel. `stable` and `canary` are conventional; any slug is valid. */
export type Channel = string;

/** The default release channel when a config or build omits one. */
export const DEFAULT_CHANNEL: Channel = 'stable';

/** The OS tag used in artifact names. */
export type ArtifactOs = 'macos' | 'linux' | 'windows';

/** Everything needed to name a build's artifacts deterministically. */
export type ArtifactSpec = {
  readonly name: string;
  readonly channel: Channel;
  readonly os: ArtifactOs;
  readonly arch: Arch;
};

/**
 * The manifest written to `version.json` beside a build's artifact, and served
 * as a channel's `update.json` feed. The runtime updater compares its
 * `version` against the running app and downloads `artifact` when newer.
 */
export type UpdateManifest = {
  readonly name: string;
  readonly version: string;
  readonly channel: Channel;
  readonly os: ArtifactOs;
  readonly arch: Arch;
  /** wyhash (Bun.hash) hex digest of the artifact bytes, for integrity. */
  readonly hash: string;
  /** Byte length of the artifact. */
  readonly size: number;
  /** Artifact file name, resolved relative to the manifest's own location. */
  readonly artifact: string;
};

/** Serialize an {@link UpdateManifest} to the pretty JSON written to a feed. */
export const serializeUpdateManifest = (manifest: UpdateManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`;

/**
 * Parse + validate an {@link UpdateManifest} from a feed's JSON text. Throws a
 * descriptive `Error` if a required field is missing or the wrong type, so a
 * malformed/HTML response from a feed is rejected rather than treated as "no
 * update".
 */
export const parseUpdateManifest = (json: string): UpdateManifest => {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('update manifest: not valid JSON');
  }
  if (raw === null || typeof raw !== 'object') {
    throw new Error('update manifest: must be a JSON object');
  }
  const record = raw as Record<string, unknown>;
  const str = (field: string): string => {
    const value = record[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`update manifest: "${field}" must be a non-empty string`);
    }
    return value;
  };
  const num = (field: string): number => {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`update manifest: "${field}" must be a number`);
    }
    return value;
  };
  const os = str('os');
  if (os !== 'macos' && os !== 'linux' && os !== 'windows') {
    throw new Error(`update manifest: "os" must be macos, linux or windows (got ${os})`);
  }
  const arch = str('arch');
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`update manifest: "arch" must be x64 or arm64 (got ${arch})`);
  }
  return {
    name: str('name'),
    version: str('version'),
    channel: str('channel'),
    os,
    arch,
    hash: str('hash'),
    size: num('size'),
    artifact: str('artifact'),
  };
};

/** Lowercase, filesystem-safe slug of an app name (`My App!` -> `my-app`). */
export const slugifyName = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'app';
};

/** The flat base name shared by a build's artifacts: `name-channel-os-arch`. */
export const artifactBaseName = (spec: ArtifactSpec): string =>
  `${slugifyName(spec.name)}-${spec.channel}-${spec.os}-${spec.arch}`;

/** {@link artifactBaseName} with an extension, e.g. `app-stable-macos-arm64.tar.zst`. */
export const artifactFileName = (spec: ArtifactSpec, ext: string): string =>
  `${artifactBaseName(spec)}.${ext.replace(/^\.+/, '')}`;

/** wyhash content hash of artifact bytes, as a zero-padded 16-char hex digest. */
export const contentHash = (bytes: Parameters<typeof Bun.hash>[0]): string =>
  (Bun.hash(bytes) as bigint).toString(16).padStart(16, '0');

/**
 * Split a SemVer string into numeric main segments and prerelease identifiers,
 * dropping any `+build` metadata. `1.2.3-canary.4+abc` -> `[[1,2,3],['canary','4']]`.
 */
const parseVersion = (version: string): { readonly main: number[]; readonly pre: string[] } => {
  const [coreAndPre] = version.trim().split('+', 1);
  const core = coreAndPre ?? '';
  const dash = core.indexOf('-');
  const mainPart = dash === -1 ? core : core.slice(0, dash);
  const prePart = dash === -1 ? '' : core.slice(dash + 1);
  const main = mainPart.split('.').map((segment) => {
    const value = Number.parseInt(segment, 10);
    return Number.isNaN(value) ? 0 : value;
  });
  const pre = prePart.length > 0 ? prePart.split('.') : [];
  return { main, pre };
};

/** Compare two prerelease identifier lists by SemVer precedence rules. */
const comparePrerelease = (a: string[], b: string[]): number => {
  // A version with no prerelease outranks one that has it (1.0.0 > 1.0.0-rc).
  if (a.length === 0 && b.length === 0) {
    return 0;
  }
  if (a.length === 0) {
    return 1;
  }
  if (b.length === 0) {
    return -1;
  }
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const ai = a[i];
    const bi = b[i];
    // A longer prerelease (when all preceding are equal) has higher precedence.
    if (ai === undefined) {
      return -1;
    }
    if (bi === undefined) {
      return 1;
    }
    const an = Number.parseInt(ai, 10);
    const bn = Number.parseInt(bi, 10);
    const aNum = String(an) === ai;
    const bNum = String(bn) === bi;
    if (aNum && bNum) {
      if (an !== bn) {
        return an < bn ? -1 : 1;
      }
    } else if (aNum !== bNum) {
      // Numeric identifiers always have lower precedence than non-numeric.
      return aNum ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
};

/**
 * Compare two SemVer-ish versions, returning `-1`, `0`, or `1`. Handles missing
 * segments (`1.2` == `1.2.0`), `+build` metadata (ignored), and prerelease
 * precedence (`1.0.0-rc.1` < `1.0.0-rc.2` < `1.0.0`).
 */
export const compareVersions = (a: string, b: string): -1 | 0 | 1 => {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const len = Math.max(va.main.length, vb.main.length);
  for (let i = 0; i < len; i += 1) {
    const ai = va.main[i] ?? 0;
    const bi = vb.main[i] ?? 0;
    if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return comparePrerelease(va.pre, vb.pre) as -1 | 0 | 1;
};

/** Whether `remote` is a strictly newer version than `local`. */
export const isNewerVersion = (remote: string, local: string): boolean =>
  compareVersions(remote, local) > 0;
