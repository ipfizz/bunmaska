import { EventEmitter } from 'node:events';
import { service } from '../platform/index';
import type { ThemeSource } from '../platform/services';

const { get: getBackend } = service('nativeTheme');

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
    return getBackend().shouldUseDarkColors();
  }

  /** macOS Accessibility "Reduce transparency"; always `false` elsewhere. */
  get prefersReducedTransparency(): boolean {
    return getBackend().prefersReducedTransparency();
  }

  /** `'system'` follows the OS. Setting it emits `updated`; only macOS also re-themes its windows. */
  get themeSource(): ThemeSource {
    return this.#themeSource;
  }

  set themeSource(source: ThemeSource) {
    this.#themeSource = source;
    getBackend().setThemeSource(source);
    this.emit('updated');
  }
}

export const nativeTheme = new NativeThemeImpl();
export type NativeTheme = NativeThemeImpl;

let observing = false;

/** Called once from bootstrap `onReady` (D034); later calls are no-ops. @internal */
export const startNativeThemeObserving = (
  observe: (onChange: () => void) => void = (onChange) => getBackend().observe(onChange),
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
