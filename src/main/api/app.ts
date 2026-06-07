import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { makeCancelableEvent } from '../../common/cancelable-event';
import { type AppEnvironment, defaultAppEnvironment } from './app-environment';
import { localeCountryCode } from './app-locale';
import { resolveAppName, resolveAppVersion } from './app-metadata';
import { type AppPathName, resolveAppPath } from './app-paths';
import { Menu } from './menu';
import { createLockBackend } from './single-instance-backend';
import { SingleInstanceManager } from './single-instance';

/**
 * Application lifecycle controller — the drop-in equivalent of Electron's `app`.
 *
 * Extends Node's {@link EventEmitter} so the full listener API
 * (`on`/`once`/`addListener`/`removeListener`/`emit`/…) matches Electron's
 * contract (D023). Events: `ready`, `before-quit`, `will-quit`,
 * `window-all-closed`, `quit`.
 *
 * The class is kept free of any native (FFI) dependency so it unit-tests without
 * FFI: the native bootstrap is supplied as an injectable hook
 * ({@link setStartHook}) by the runtime barrel, and the host facts behind the
 * metadata/path/locale methods come from an injectable {@link AppEnvironment}
 * (the live one is built lazily from `os`/`process`/`fs`/`Intl`).
 */
export class App extends EventEmitter {
  #ready = false;
  #quitting = false;
  #startHook: (() => void) | undefined;
  #env: AppEnvironment | undefined;
  #nameOverride: string | undefined;
  #singleInstance: SingleInstanceManager | undefined;
  readonly #pathOverrides = new Map<AppPathName, string>();

  /** The resolved host environment, built lazily on first use. */
  #environment(): AppEnvironment {
    this.#env ??= defaultAppEnvironment();
    return this.#env;
  }

  /**
   * Replace the resolved environment with a fake.
   * @internal Test-only seam; production builds the real environment lazily.
   */
  setEnvironmentForTesting(env: AppEnvironment): void {
    this.#env = env;
  }

  /**
   * Reset mutable state and app-level window-event listeners back to defaults.
   * Lifecycle listeners (`before-quit`/`will-quit`/`quit`) are left intact so the
   * native bootstrap wiring survives.
   * @internal Test-only seam for suites that exercise the shared `app` singleton.
   */
  resetForTesting(): void {
    this.#env = undefined;
    this.#quitting = false;
    this.#nameOverride = undefined;
    this.#singleInstance = undefined;
    this.#pathOverrides.clear();
    for (const event of [
      'activate',
      'window-all-closed',
      'browser-window-created',
      'browser-window-focus',
      'browser-window-blur',
      'web-contents-created',
    ]) {
      this.removeAllListeners(event);
    }
  }

  /** Whether the `ready` event has already fired. */
  get isReady(): boolean {
    return this.#ready;
  }

  /**
   * Resolves once the app is ready to create windows. The first call triggers
   * the native bootstrap (if a start hook is wired); resolves immediately if
   * the app is already ready.
   */
  whenReady(): Promise<void> {
    if (!this.#ready) {
      this.#startHook?.();
    }
    if (this.#ready) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.once('ready', () => resolve());
    });
  }

  /**
   * Mark the app ready and emit `ready`. Idempotent.
   * @internal Invoked by the native bootstrap once the runtime is up.
   */
  markReady(): void {
    if (this.#ready) {
      return;
    }
    this.#ready = true;
    this.emit('ready');
  }

  /**
   * Register the native bootstrap to run on the first {@link whenReady}.
   * @internal Wired by the runtime barrel; never called by app code.
   */
  setStartHook(hook: () => void): void {
    this.#startHook = hook;
  }

  /** The application name: `setName` override, else `productName`/`name` from the app's `package.json`. */
  getName(): string {
    return resolveAppName(this.#environment().manifest, this.#nameOverride);
  }

  /** Override the application name (also changes the `userData` directory name). */
  setName(name: string): void {
    this.#nameOverride = name;
  }

  /** Accessor form of {@link getName}/{@link setName}. */
  get name(): string {
    return this.getName();
  }

  set name(value: string) {
    this.setName(value);
  }

  /** The application version from the app's `package.json`. */
  getVersion(): string {
    return resolveAppVersion(this.#environment().manifest);
  }

  /** The application root directory (the nearest `package.json`, or cwd). */
  getAppPath(): string {
    return this.#environment().appPath;
  }

  /** Resolve a special directory by name (Electron's `app.getPath`). */
  getPath(name: AppPathName): string {
    const override = this.#pathOverrides.get(name);
    if (override !== undefined) {
      return override;
    }
    const env = this.#environment();
    return resolveAppPath(name, {
      platform: env.platform,
      home: env.home,
      temp: env.temp,
      appName: this.getName(),
      execPath: env.execPath,
      appPath: env.appPath,
      env: env.env,
    });
  }

  /** Override the path returned by {@link getPath} for a given name. */
  setPath(name: AppPathName, path: string): void {
    this.#pathOverrides.set(name, path);
  }

  /** Override the directory used for app logs (`getPath('logs')`). */
  setAppLogsPath(path?: string): void {
    this.#pathOverrides.set('logs', path ?? this.getPath('logs'));
  }

  /** The current application locale as a normalized BCP-47 tag. */
  getLocale(): string {
    return this.#environment().locale;
  }

  /** The system locale; for Sambar this matches {@link getLocale}. */
  getSystemLocale(): string {
    return this.#environment().locale;
  }

  /** The two-letter country/region code of the current locale, or `''`. */
  getLocaleCountryCode(): string {
    return localeCountryCode(this.#environment().locale);
  }

  /** The user's preferred languages, most-preferred first. */
  getPreferredSystemLanguages(): string[] {
    return this.#environment().preferredLanguages;
  }

  /** Whether the app is running from a packaged build (vs. the dev runner). */
  get isPackaged(): boolean {
    return this.#environment().isPackaged;
  }

  /** The application menu bar (Electron's `app.applicationMenu`), or `null`. */
  get applicationMenu(): Menu | null {
    return Menu.getApplicationMenu();
  }

  set applicationMenu(menu: Menu | null) {
    Menu.setApplicationMenu(menu);
  }

  /** Exit immediately with `exitCode` (default 0), skipping the quit events. */
  exit(exitCode = 0): void {
    this.#environment().exit(exitCode);
  }

  /** Relaunch the app when the current instance exits (Electron's `relaunch`). */
  relaunch(options?: { args?: string[]; execPath?: string }): void {
    const env = this.#environment();
    const execPath = options?.execPath ?? env.execPath;
    const args = options?.args ?? process.argv.slice(1);
    env.relaunch(execPath, args);
  }

  /** The single-instance lock manager, created lazily over the real backend. */
  #singleInstanceManager(): SingleInstanceManager {
    this.#singleInstance ??= new SingleInstanceManager(createLockBackend(), {
      lockPath: join(this.getPath('userData'), 'SingletonLock'),
      socketPath: join(this.getPath('userData'), 'SingletonSocket'),
      pid: process.pid,
    });
    return this.#singleInstance;
  }

  /**
   * Replace the single-instance manager with a fake.
   * @internal Test-only seam.
   */
  setSingleInstanceForTesting(manager: SingleInstanceManager): void {
    this.#singleInstance = manager;
  }

  /**
   * Acquire the single-instance lock. Returns `true` if this is the primary
   * instance; `false` if another instance already holds it (in which case it has
   * been handed this process's argv/cwd via its `second-instance` event, and the
   * caller should quit).
   */
  requestSingleInstanceLock(additionalData: unknown = undefined): boolean {
    const payload = { argv: [...process.argv], cwd: process.cwd(), additionalData };
    return this.#singleInstanceManager().request(payload, (p) => {
      this.emit('second-instance', makeCancelableEvent(), p.argv, p.cwd, p.additionalData);
    });
  }

  /** Whether this process holds the single-instance lock. */
  hasSingleInstanceLock(): boolean {
    return this.#singleInstanceManager().has();
  }

  /** Release the single-instance lock held by this process. */
  releaseSingleInstanceLock(): void {
    this.#singleInstanceManager().release();
  }

  /**
   * Begin shutting the app down. Emits the cancelable `before-quit` then
   * `will-quit` events (a listener may call `preventDefault()` on the passed
   * event to abort the quit); if neither vetoes, emits `quit` with the exit code
   * and exits the process. The native bootstrap listens for `will-quit` to stop
   * the run loop before the process exits.
   */
  quit(exitCode = 0): void {
    if (this.#quitting) {
      return;
    }
    this.#quitting = true;

    const beforeQuit = makeCancelableEvent();
    this.emit('before-quit', beforeQuit);
    if (beforeQuit.defaultPrevented) {
      this.#quitting = false;
      return;
    }

    const willQuit = makeCancelableEvent();
    this.emit('will-quit', willQuit);
    if (willQuit.defaultPrevented) {
      this.#quitting = false;
      return;
    }

    this.emit('quit', exitCode);
    this.#environment().exit(exitCode);
  }
}

/** The application lifecycle singleton. Drop-in equivalent of Electron's `app`. */
export const app = new App();
