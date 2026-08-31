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

/**
 * System appearance — a drop-in equivalent of Electron's `nativeTheme`. Extends
 * {@link EventEmitter} for the `updated` event (D023).
 * {@link NativeThemeImpl.startObserving}, wired once at startup, makes `updated`
 * also fire when the OS appearance changes underneath the app (macOS/Linux; a
 * Windows appearance watcher is a follow-up).
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
  const platform = currentPlatform();
  if (platform === 'macos') {
    macosObserveAppearance(onChange);
  } else if (platform === 'linux') {
    linuxObserveAppearance(onChange);
  }
};

export class NativeThemeImpl extends EventEmitter {
  #themeSource: ThemeSource = 'system';
  #observing = false;

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

  /** macOS Accessibility "Reduce transparency"; always `false` on Linux. */
  get prefersReducedTransparency(): boolean {
    return osPrefersReducedTransparency();
  }

  /** `'system'` follows the OS; setting this re-themes web views and emits `updated`. */
  get themeSource(): ThemeSource {
    return this.#themeSource;
  }

  set themeSource(source: ThemeSource) {
    this.#themeSource = source;
    applyThemeSource(source);
    this.emit('updated');
  }

  /** Idempotent: only the first call registers an observer. */
  startObserving(observe: (onChange: () => void) => void = observeOsAppearance): void {
    if (this.#observing) {
      return;
    }
    this.#observing = true;
    observe(() => this.emit('updated'));
  }

  /** @internal */
  resetObservingForTesting(): void {
    this.#observing = false;
  }
}

/** The application appearance singleton — Electron's `nativeTheme`. */
export const nativeTheme = new NativeThemeImpl();
export type NativeTheme = NativeThemeImpl;
