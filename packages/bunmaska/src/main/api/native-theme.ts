import { EventEmitter } from 'node:events';
import { currentPlatform } from '../../common/platform';
import {
  observeAppearanceChange as macosObserveAppearance,
  prefersReducedTransparency as macosPrefersReducedTransparency,
  setAppearance as macosSetAppearance,
  shouldUseDarkColors as macosShouldUseDarkColors,
} from '../platform/macos/cocoa-native-theme';
import {
  observeAppearanceChange as linuxObserveAppearance,
  shouldUseDarkColors as linuxShouldUseDarkColors,
} from '../platform/linux/gtk-native-theme';

/**
 * System appearance — a drop-in equivalent of Electron's `nativeTheme`.
 *
 * Extends {@link EventEmitter} for the `updated` event (D023). `shouldUseDarkColors`
 * honors the `themeSource` override ('light'/'dark'), falling back to the OS
 * appearance for 'system'. Setting `themeSource` applies an app-wide appearance
 * (so web views re-theme) and emits `updated`. `shouldUseDarkColors` reads the
 * real OS appearance on both platforms (macOS `AppleInterfaceStyle`, Linux
 * `GtkSettings`). {@link NativeThemeImpl.startObserving} (wired once at startup)
 * makes `updated` also fire when the OS appearance changes underneath the app.
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

/** Whether the OS requests reduced transparency. macOS-only; `false` elsewhere. */
const osPrefersReducedTransparency = (): boolean =>
  currentPlatform() === 'macos' ? macosPrefersReducedTransparency() : false;

/** Register the platform's OS-appearance-change observer, firing `onChange` on a flip. */
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

  /**
   * Whether the OS requests reduced transparency (macOS Accessibility "Reduce
   * transparency"). Always `false` on Linux, which has no equivalent setting.
   */
  get prefersReducedTransparency(): boolean {
    return osPrefersReducedTransparency();
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

  /**
   * Begin emitting `updated` when the OS appearance changes (idempotent — only
   * the first call registers an observer). Wired once at startup by the
   * bootstrap. `observe` is injectable so the wiring is unit-testable without
   * touching native APIs.
   */
  startObserving(observe: (onChange: () => void) => void = observeOsAppearance): void {
    if (this.#observing) {
      return;
    }
    this.#observing = true;
    observe(() => this.emit('updated'));
  }

  /** Reset the observe-once guard. Test-only. */
  resetObservingForTesting(): void {
    this.#observing = false;
  }
}

/** The application appearance singleton. Drop-in equivalent of Electron's `nativeTheme`. */
export const nativeTheme = new NativeThemeImpl();
export type NativeTheme = NativeThemeImpl;
