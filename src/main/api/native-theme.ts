import { EventEmitter } from 'node:events';
import { currentPlatform } from '../../common/platform';
import {
  observeAppearanceChange as linuxObserveAppearance,
  shouldUseDarkColors as linuxShouldUseDarkColors,
} from '../platform/linux/gtk-native-theme';
import {
  observeAppearanceChange as macosObserveAppearance,
  prefersReducedTransparency as macosPrefersReducedTransparency,
  setAppearance as macosSetAppearance,
  shouldUseDarkColors as macosShouldUseDarkColors,
} from '../platform/macos/cocoa-native-theme';
import { windowsShouldUseDarkColors } from '../platform/windows/windows-native-theme';

export type ThemeSource = 'system' | 'light' | 'dark';

const osShouldUseDark = (): boolean => {
  const platform = currentPlatform();
  if (platform === 'macos') {
    return macosShouldUseDarkColors();
  }
  if (platform === 'linux') {
    return linuxShouldUseDarkColors();
  }
  if (platform === 'windows') {
    return windowsShouldUseDarkColors();
  }
  return false;
};

const applyThemeSource = (source: ThemeSource): void => {
  if (currentPlatform() === 'macos') {
    macosSetAppearance(source);
  }
};

const osPrefersReducedTransparency = (): boolean =>
  currentPlatform() === 'macos' ? macosPrefersReducedTransparency() : false;

const observeOsAppearance = (onChange: () => void): void => {
  // ponytail: no Windows appearance watcher
  const platform = currentPlatform();
  if (platform === 'macos') {
    macosObserveAppearance(onChange);
  } else if (platform === 'linux') {
    linuxObserveAppearance(onChange);
  }
};

export class NativeThemeImpl extends EventEmitter {
  #themeSource: ThemeSource = 'system';

  /** Honors {@link themeSource}; falls back to the OS appearance for `'system'`. */
  get shouldUseDarkColors(): boolean {
    if (this.#themeSource === 'dark') {
      return true;
    }
    if (this.#themeSource === 'light') {
      return false;
    }
    return osShouldUseDark();
  }

  /** macOS Accessibility "Reduce transparency"; always `false` elsewhere. */
  get prefersReducedTransparency(): boolean {
    return osPrefersReducedTransparency();
  }

  /** `'system'` follows the OS. Setting it emits `updated`; only macOS also re-themes its windows. */
  get themeSource(): ThemeSource {
    return this.#themeSource;
  }

  set themeSource(source: ThemeSource) {
    this.#themeSource = source;
    applyThemeSource(source);
    this.emit('updated');
  }
}

export const nativeTheme = new NativeThemeImpl();
export type NativeTheme = NativeThemeImpl;

let observing = false;

/** Called once from bootstrap `onReady` (D034); later calls are no-ops. @internal */
export const startNativeThemeObserving = (
  observe: (onChange: () => void) => void = observeOsAppearance,
): void => {
  if (observing) {
    return;
  }
  observing = true;
  observe(() => nativeTheme.emit('updated'));
};

/** @internal */
export const resetNativeThemeObservingForTesting = (): void => {
  observing = false;
};
