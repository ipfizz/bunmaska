/**
 * The *only* module allowed to read `process.platform` and `process.arch`. All
 * other code calls {@link currentPlatform}, {@link currentArch} or
 * {@link isSupported}.
 */

import { UnsupportedPlatformError } from './errors';

export type Platform = 'macos' | 'linux' | 'windows';

/** CPU architecture tag used in distributable artifact names. */
export type Arch = 'x64' | 'arm64';

const RAW_TO_PLATFORM = new Map<string, Platform>([
  ['darwin', 'macos'],
  ['linux', 'linux'],
  ['win32', 'windows'],
]);

const RAW_TO_ARCH = new Map<string, Arch>([
  ['x64', 'x64'],
  ['arm64', 'arm64'],
]);

const SUPPORTED: ReadonlySet<Platform> = new Set<Platform>(['macos', 'linux', 'windows']);

/** Map a Node platform tag (`'darwin'`, `'win32'`, …) to ours. Throws if unrecognised. */
export const mapPlatform = (raw: string): Platform => {
  const mapped = RAW_TO_PLATFORM.get(raw);
  if (mapped === undefined) {
    throw new UnsupportedPlatformError(`Unsupported platform: ${raw}`);
  }
  return mapped;
};

/** Whether Bunmaska currently ships a working backend for this platform. */
export const isSupported = (platform: Platform): boolean => SUPPORTED.has(platform);

/** The host's platform tag. Throws if the OS is not one Bunmaska recognises. */
export const currentPlatform = (): Platform => mapPlatform(process.platform);

/** Map a Node arch tag to ours. Throws on an arch we build no distributables for. */
export const mapArch = (raw: string): Arch => {
  const mapped = RAW_TO_ARCH.get(raw);
  if (mapped === undefined) {
    throw new UnsupportedPlatformError(`Unsupported architecture: ${raw}`);
  }
  return mapped;
};

/** The host's arch tag. Throws on a CPU we build no distributables for. */
export const currentArch = (): Arch => mapArch(process.arch);
