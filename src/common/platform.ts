/**
 * Platform identification for Bunmaska.
 *
 * This is the *only* module that is allowed to read `process.platform` and
 * `process.arch`. All other code calls {@link currentPlatform},
 * {@link currentArch} or {@link isSupported}.
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

const SUPPORTED: ReadonlySet<Platform> = new Set<Platform>(['macos', 'linux']);

/**
 * Map a Node-style platform tag (`'darwin'`, `'linux'`, `'win32'`) to Bunmaska's
 * canonical platform tag. Throws on anything unrecognised.
 */
export const mapPlatform = (raw: string): Platform => {
  const mapped = RAW_TO_PLATFORM.get(raw);
  if (mapped === undefined) {
    throw new UnsupportedPlatformError(`Unsupported platform: ${raw}`);
  }
  return mapped;
};

/**
 * Whether Bunmaska currently ships a working backend for this platform.
 * macOS and Linux are supported; Windows is deferred (see `.admin/WINDOWS.md`).
 */
export const isSupported = (platform: Platform): boolean => SUPPORTED.has(platform);

/**
 * The canonical platform tag of the host this code is running on.
 * Throws if the host OS is not one Bunmaska knows how to recognise at all.
 */
export const currentPlatform = (): Platform => mapPlatform(process.platform);

/**
 * Map a Node-style architecture tag (`'x64'`, `'arm64'`) to Bunmaska's canonical
 * arch tag. Throws on anything Bunmaska does not build distributables for.
 */
export const mapArch = (raw: string): Arch => {
  const mapped = RAW_TO_ARCH.get(raw);
  if (mapped === undefined) {
    throw new UnsupportedPlatformError(`Unsupported architecture: ${raw}`);
  }
  return mapped;
};

/**
 * The canonical architecture tag of the host this code is running on.
 * Throws if the host CPU is not one Bunmaska builds distributables for.
 */
export const currentArch = (): Arch => mapArch(process.arch);
