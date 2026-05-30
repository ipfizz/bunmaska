import { currentPlatform } from '../../common/platform';
import { shouldUseDarkColors as macosShouldUseDarkColors } from '../platform/macos/cocoa-native-theme';

/**
 * System appearance info — a minimal drop-in equivalent of Electron's
 * `nativeTheme`. Today it exposes `shouldUseDarkColors` (read-only); the
 * `themeSource` setter and `updated` event arrive in a later increment.
 *
 * Unlike clipboard (where an unsupported platform throws, since silently
 * dropping a write would lose data), this read-only boolean returns a sensible
 * default of `false` (light) on platforms without a backend, so drop-in apps
 * that read it at startup degrade gracefully instead of crashing.
 */

export type NativeTheme = {
  /** Whether the OS is currently using a dark appearance. */
  readonly shouldUseDarkColors: boolean;
};

export const nativeTheme: NativeTheme = {
  get shouldUseDarkColors(): boolean {
    return currentPlatform() === 'macos' ? macosShouldUseDarkColors() : false;
  },
};
