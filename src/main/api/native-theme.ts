import { EventEmitter } from 'node:events';
import { currentPlatform } from '../../common/platform';
import {
  setAppearance as macosSetAppearance,
  shouldUseDarkColors as macosShouldUseDarkColors,
} from '../platform/macos/cocoa-native-theme';
import { shouldUseDarkColors as linuxShouldUseDarkColors } from '../platform/linux/gtk-native-theme';

/**
 * System appearance — a drop-in equivalent of Electron's `nativeTheme`.
 *
 * Extends {@link EventEmitter} for the `updated` event (D023). `shouldUseDarkColors`
 * honors the `themeSource` override ('light'/'dark'), falling back to the OS
 * appearance for 'system'. Setting `themeSource` applies an app-wide appearance
 * (so web views re-theme) and emits `updated`. `shouldUseDarkColors` reads the
 * real OS appearance on both platforms (macOS `AppleInterfaceStyle`, Linux
 * `GtkSettings`). The observer that fires `updated` on an OS-driven appearance
 * change lands in a follow-up; today `updated` fires on `themeSource` changes.
 */

export type ThemeSource = 'system' | 'light' | 'dark';

const osShouldUseDark = (): boolean => {
  const platform = currentPlatform();
  if (platform === 'macos') {
    return macosShouldUseDarkColors();
  }
  if (platform === 'linux') {
    return linuxShouldUseDarkColors();
  }
  return false;
};

const applyThemeSource = (source: ThemeSource): void => {
  if (currentPlatform() === 'macos') {
    macosSetAppearance(source);
  }
};

export class NativeThemeImpl extends EventEmitter {
  #themeSource: ThemeSource = 'system';

  /** Whether a dark appearance should be used, honoring {@link themeSource}. */
  get shouldUseDarkColors(): boolean {
    if (this.#themeSource === 'dark') {
      return true;
    }
    if (this.#themeSource === 'light') {
      return false;
    }
    return osShouldUseDark();
  }

  /** The appearance override: `'system'` follows the OS, else forces light/dark. */
  get themeSource(): ThemeSource {
    return this.#themeSource;
  }

  set themeSource(source: ThemeSource) {
    this.#themeSource = source;
    applyThemeSource(source);
    this.emit('updated');
  }
}

/** The application appearance singleton. Drop-in equivalent of Electron's `nativeTheme`. */
export const nativeTheme = new NativeThemeImpl();
export type NativeTheme = NativeThemeImpl;
