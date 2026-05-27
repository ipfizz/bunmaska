/**
 * Platform identification for Sambar.
 *
 * This is the *only* module that is allowed to read `process.platform`.
 * All other code calls {@link currentPlatform} or {@link isSupported}.
 */

export type Platform = 'macos' | 'linux' | 'windows';

const RAW_TO_PLATFORM = new Map<string, Platform>([
  ['darwin', 'macos'],
  ['linux', 'linux'],
  ['win32', 'windows'],
]);

const SUPPORTED: ReadonlySet<Platform> = new Set<Platform>(['macos', 'linux']);

/**
 * Map a Node-style platform tag (`'darwin'`, `'linux'`, `'win32'`) to Sambar's
 * canonical platform tag. Throws on anything unrecognised.
 */
export const mapPlatform = (raw: string): Platform => {
  const mapped = RAW_TO_PLATFORM.get(raw);
  if (mapped === undefined) {
    throw new Error(`Unsupported platform: ${raw}`);
  }
  return mapped;
};

/**
 * Whether Sambar currently ships a working backend for this platform.
 * macOS and Linux are supported; Windows is deferred (see `.admin/WINDOWS.md`).
 */
export const isSupported = (platform: Platform): boolean => SUPPORTED.has(platform);

/**
 * The canonical platform tag of the host this code is running on.
 * Throws if the host OS is not one Sambar knows how to recognise at all.
 */
export const currentPlatform = (): Platform => mapPlatform(process.platform);
