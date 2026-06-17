import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, test } from 'bun:test';
import { App, app } from '../../../../src/main/api/app';
import { setNativeAppForTesting } from '../../../../src/main/native-app';
import type { NativeAppKit, NativeApplication } from '../../../../src/main/platform/native';
import {
  type AppEnvironment,
  buildAppEnvironment,
  type EnvironmentDeps,
} from '../../../../src/main/api/app-environment';
import {
  encodePayload,
  type LockBackend,
  SingleInstanceManager,
} from '../../../../src/main/api/single-instance';
import { Menu, resetApplicationMenuForTesting } from '../../../../src/main/api/menu';

const fakeEnv = (overrides: Partial<EnvironmentDeps> = {}): AppEnvironment =>
  buildAppEnvironment({
    platform: 'macos',
    home: '/Users/ada',
    temp: '/tmp',
    execPath: '/opt/homebrew/bin/bun',
    mainScript: '/proj/src/main.ts',
    cwd: '/proj',
    env: {},
    locale: 'en-US',
    readFile: (path) =>
      path === '/proj/package.json'
        ? JSON.stringify({ productName: 'Demo App', name: 'demo', version: '4.2.0' })
        : undefined,
    exit: () => undefined,
    relaunch: () => undefined,
    ...overrides,
  });

/** A fresh App with an injected fake environment. */
const appWith = (overrides: Partial<EnvironmentDeps> = {}): App => {
  const a = new App();
  a.setEnvironmentForTesting(fakeEnv(overrides));
  return a;
};

describe('App singleton', () => {
  test('is an instance of App', () => {
    expect(app).toBeInstanceOf(App);
  });

  test('is a Node EventEmitter for Electron compatibility', () => {
    expect(app).toBeInstanceOf(EventEmitter);
  });
});

describe('App.isReady', () => {
  test('is false on a fresh instance', () => {
    expect(new App().isReady).toBe(false);
  });

  test('is true after markReady', () => {
    const a = new App();
    a.markReady();
    expect(a.isReady).toBe(true);
  });
});

describe('App.markReady', () => {
  test('emits ready exactly once when called multiple times', () => {
    const a = new App();
    let calls = 0;
    a.on('ready', () => {
      calls += 1;
    });
    a.markReady();
    a.markReady();
    a.markReady();
    expect(calls).toBe(1);
  });

  test('fires handlers registered before markReady', () => {
    const a = new App();
    let fired = false;
    a.on('ready', () => {
      fired = true;
    });
    a.markReady();
    expect(fired).toBe(true);
  });

  test('does not fire handlers registered after markReady', () => {
    const a = new App();
    a.markReady();
    let fired = false;
    a.on('ready', () => {
      fired = true;
    });
    expect(fired).toBe(false);
  });
});

describe('App.whenReady', () => {
  test('resolves immediately when already ready', async () => {
    const a = new App();
    a.markReady();
    await a.whenReady();
  });

  test('resolves after markReady when called before', async () => {
    const a = new App();
    const promise = a.whenReady();
    a.markReady();
    await promise;
  });

  test('invokes the start hook on first call when not ready', () => {
    const a = new App();
    let started = 0;
    a.setStartHook(() => {
      started += 1;
    });
    void a.whenReady();
    expect(started).toBe(1);
  });

  test('a start hook that marks ready resolves whenReady', async () => {
    const a = new App();
    a.setStartHook(() => a.markReady());
    await a.whenReady();
    expect(a.isReady).toBe(true);
  });
});

describe('App event surface', () => {
  test('before-quit handlers can be registered', () => {
    const a = new App();
    a.on('before-quit', () => undefined);
    expect(a.listenerCount('before-quit')).toBe(1);
  });

  test('window-all-closed handlers can be registered', () => {
    const a = new App();
    a.on('window-all-closed', () => undefined);
    expect(a.listenerCount('window-all-closed')).toBe(1);
  });

  test('supports the Electron addListener/removeListener alias surface', () => {
    const a = new App();
    const handler = (): void => undefined;
    a.addListener('will-quit', handler);
    expect(a.listenerCount('will-quit')).toBe(1);
    a.removeListener('will-quit', handler);
    expect(a.listenerCount('will-quit')).toBe(0);
  });
});

describe('App.quit', () => {
  /** An app whose env records exit codes instead of killing the process. */
  const quittableApp = (): { app: App; exits: number[] } => {
    const exits: number[] = [];
    const a = new App();
    a.setEnvironmentForTesting(
      fakeEnv({
        exit: (code) => {
          exits.push(code);
        },
      }),
    );
    return { app: a, exits };
  };

  test('emits before-quit, will-quit, then quit in order, then exits', () => {
    const { app: a, exits } = quittableApp();
    const order: string[] = [];
    a.on('before-quit', () => order.push('before-quit'));
    a.on('will-quit', () => order.push('will-quit'));
    a.on('quit', () => order.push('quit'));
    a.quit();
    expect(order).toEqual(['before-quit', 'will-quit', 'quit']);
    expect(exits).toEqual([0]);
  });

  test('before-quit preventDefault aborts the quit', () => {
    const { app: a, exits } = quittableApp();
    let willQuitFired = false;
    a.on('before-quit', (event: { preventDefault(): void }) => event.preventDefault());
    a.on('will-quit', () => {
      willQuitFired = true;
    });
    a.quit();
    expect(willQuitFired).toBe(false);
    expect(exits).toEqual([]);
  });

  test('will-quit preventDefault aborts the quit before quit/exit', () => {
    const { app: a, exits } = quittableApp();
    let quitFired = false;
    a.on('will-quit', (event: { preventDefault(): void }) => event.preventDefault());
    a.on('quit', () => {
      quitFired = true;
    });
    a.quit();
    expect(quitFired).toBe(false);
    expect(exits).toEqual([]);
  });

  test('emits quit with the exit code and exits with it', () => {
    const { app: a, exits } = quittableApp();
    let quitCode = -1;
    a.on('quit', (code: number) => {
      quitCode = code;
    });
    a.quit(5);
    expect(quitCode).toBe(5);
    expect(exits).toEqual([5]);
  });

  test('a prevented quit can be retried', () => {
    const { app: a, exits } = quittableApp();
    let prevent = true;
    a.on('before-quit', (event: { preventDefault(): void }) => {
      if (prevent) {
        event.preventDefault();
      }
    });
    a.quit();
    expect(exits).toEqual([]);
    prevent = false;
    a.quit();
    expect(exits).toEqual([0]);
  });
});

describe('App name & version', () => {
  test('getName prefers productName from the manifest', () => {
    expect(appWith().getName()).toBe('Demo App');
  });

  test('setName overrides getName and the name accessor mirrors it', () => {
    const a = appWith();
    a.setName('Renamed');
    expect(a.getName()).toBe('Renamed');
    expect(a.name).toBe('Renamed');
    a.name = 'Again';
    expect(a.getName()).toBe('Again');
  });

  test('getVersion returns the manifest version', () => {
    expect(appWith().getVersion()).toBe('4.2.0');
  });

  test('userAgentFallback defaults to empty and is settable', () => {
    const a = appWith();
    expect(a.userAgentFallback).toBe('');
    a.userAgentFallback = 'MyApp/1.0';
    expect(a.userAgentFallback).toBe('MyApp/1.0');
  });
});

describe('App paths', () => {
  test('getAppPath returns the resolved app root', () => {
    expect(appWith().getAppPath()).toBe('/proj');
  });

  test('getPath(userData) is appData/<name> using the resolved name', () => {
    expect(appWith().getPath('userData')).toBe('/Users/ada/Library/Application Support/Demo App');
  });

  test('getPath reflects a setName override in userData', () => {
    const a = appWith();
    a.setName('Renamed');
    expect(a.getPath('userData')).toBe('/Users/ada/Library/Application Support/Renamed');
  });

  test('setPath overrides a specific path', () => {
    const a = appWith();
    a.setPath('userData', '/custom/data');
    expect(a.getPath('userData')).toBe('/custom/data');
  });
});

describe('App locale', () => {
  test('getLocale returns the normalized locale', () => {
    expect(appWith({ locale: 'en_US.UTF-8' }).getLocale()).toBe('en-US');
  });

  test('getSystemLocale matches getLocale', () => {
    const a = appWith({ locale: 'fr-FR' });
    expect(a.getSystemLocale()).toBe('fr-FR');
  });

  test('getLocaleCountryCode derives the region', () => {
    expect(appWith({ locale: 'en-US' }).getLocaleCountryCode()).toBe('US');
  });

  test('getPreferredSystemLanguages reflects the environment', () => {
    expect(appWith({ env: { LANGUAGE: 'fr_FR:en_US' } }).getPreferredSystemLanguages()).toEqual([
      'fr-FR',
      'en-US',
    ]);
  });
});

describe('App.isPackaged', () => {
  test('is false under the dev runner', () => {
    expect(appWith({ execPath: '/opt/homebrew/bin/bun' }).isPackaged).toBe(false);
  });

  test('is true inside a packaged bundle', () => {
    expect(appWith({ execPath: '/Applications/Demo.app/Contents/MacOS/Demo' }).isPackaged).toBe(
      true,
    );
  });
});

describe('App.relaunch', () => {
  test('relaunches with the env execPath and current args by default', () => {
    const calls: Array<[string, string[]]> = [];
    const a = new App();
    a.setEnvironmentForTesting(
      fakeEnv({
        execPath: '/bin/myapp',
        relaunch: (execPath, args) => {
          calls.push([execPath, args]);
        },
      }),
    );
    a.relaunch();
    expect(calls).toEqual([['/bin/myapp', process.argv.slice(1)]]);
  });

  test('honors execPath and args overrides', () => {
    const calls: Array<[string, string[]]> = [];
    const a = new App();
    a.setEnvironmentForTesting(
      fakeEnv({
        relaunch: (execPath, args) => {
          calls.push([execPath, args]);
        },
      }),
    );
    a.relaunch({ execPath: '/custom', args: ['--restart'] });
    expect(calls).toEqual([['/custom', ['--restart']]]);
  });
});

describe('App single-instance lock', () => {
  /** A real manager over a fake backend; exposes the captured server callback. */
  const managerWith = (
    opts: { acquire?: boolean[]; existingPid?: number; alive?: boolean } = {},
  ): { manager: SingleInstanceManager; deliver: (json: string) => void; stops: () => number } => {
    const acquireQueue = [...(opts.acquire ?? [true])];
    let onMessage: ((json: string) => void) | undefined;
    let stops = 0;
    const backend: LockBackend = {
      tryCreateLock: () => acquireQueue.shift() ?? false,
      readLockPid: () => opts.existingPid,
      isAlive: () => opts.alive ?? false,
      clearLock: () => undefined,
      startServer: (_path, cb) => {
        onMessage = cb;
      },
      notify: () => undefined,
      stop: () => {
        stops += 1;
      },
    };
    return {
      manager: new SingleInstanceManager(backend, {
        lockPath: '/l',
        socketPath: '/s',
        pid: 1,
      }),
      deliver: (json) => onMessage?.(json),
      stops: () => stops,
    };
  };

  test('requestSingleInstanceLock returns true for the primary', () => {
    const a = new App();
    a.setSingleInstanceForTesting(managerWith({ acquire: [true] }).manager);
    expect(a.requestSingleInstanceLock()).toBe(true);
    expect(a.hasSingleInstanceLock()).toBe(true);
  });

  test('requestSingleInstanceLock returns false for a secondary', () => {
    const a = new App();
    a.setSingleInstanceForTesting(
      managerWith({ acquire: [false], existingPid: 999, alive: true }).manager,
    );
    expect(a.requestSingleInstanceLock()).toBe(false);
    expect(a.hasSingleInstanceLock()).toBe(false);
  });

  test('emits second-instance with argv/cwd/data when a peer connects', () => {
    const a = new App();
    const fixture = managerWith({ acquire: [true] });
    a.setSingleInstanceForTesting(fixture.manager);
    let captured: { argv: string[]; cwd: string; data: unknown } | undefined;
    a.on('second-instance', (_event: unknown, argv: string[], cwd: string, data: unknown) => {
      captured = { argv, cwd, data };
    });
    a.requestSingleInstanceLock();
    fixture.deliver(encodePayload({ argv: ['p', 'q'], cwd: '/peer', additionalData: { z: 1 } }));
    expect(captured).toEqual({ argv: ['p', 'q'], cwd: '/peer', data: { z: 1 } });
  });

  test('releaseSingleInstanceLock releases the lock', () => {
    const a = new App();
    const fixture = managerWith({ acquire: [true] });
    a.setSingleInstanceForTesting(fixture.manager);
    a.requestSingleInstanceLock();
    a.releaseSingleInstanceLock();
    expect(fixture.stops()).toBe(1);
    expect(a.hasSingleInstanceLock()).toBe(false);
  });
});

describe('App macOS desktop integration', () => {
  type DesktopCalls = {
    policy: string[];
    hidden: number;
    shown: number;
    badges: string[];
    bounces: boolean[];
    about: number;
  };

  /** Install a fake native app (optionally with macOS appKit) and record calls. */
  const install = (withAppKit: boolean): DesktopCalls => {
    const calls: DesktopCalls = {
      policy: [],
      hidden: 0,
      shown: 0,
      badges: [],
      bounces: [],
      about: 0,
    };
    let dockBadge = '';
    const appKit: NativeAppKit = {
      setActivationPolicy: (p) => calls.policy.push(p),
      hide: () => {
        calls.hidden += 1;
      },
      show: () => {
        calls.shown += 1;
      },
      isHidden: () => true,
      isActive: () => true,
      setDockBadge: (label) => {
        dockBadge = label;
        calls.badges.push(label);
      },
      getDockBadge: () => dockBadge,
      bounceDock: (critical) => calls.bounces.push(critical),
    };
    const native: NativeApplication = {
      start: () => undefined,
      onReady: (cb) => cb(),
      createWindow: () => {
        throw new Error('createWindow unused in desktop tests');
      },
      quit: () => undefined,
      showAboutPanel: () => {
        calls.about += 1;
      },
      ...(withAppKit ? { appKit } : {}),
    };
    setNativeAppForTesting(native);
    return calls;
  };

  afterEach(() => setNativeAppForTesting(undefined));

  test('setActivationPolicy delegates to appKit', () => {
    const calls = install(true);
    new App().setActivationPolicy('accessory');
    expect(calls.policy).toEqual(['accessory']);
  });

  test('hide/show delegate to appKit', () => {
    const calls = install(true);
    const a = new App();
    a.hide();
    a.show();
    expect([calls.hidden, calls.shown]).toEqual([1, 1]);
  });

  test('isHidden/isActive reflect appKit', () => {
    install(true);
    const a = new App();
    expect(a.isHidden()).toBe(true);
    expect(a.isActive()).toBe(true);
  });

  test('showAboutPanel delegates', () => {
    const calls = install(true);
    new App().showAboutPanel();
    expect(calls.about).toBe(1);
  });

  test('dock proxies setBadge/getBadge/bounce', () => {
    const calls = install(true);
    const dock = new App().dock;
    dock?.setBadge('3');
    expect(dock?.getBadge()).toBe('3');
    dock?.bounce('critical');
    expect(calls.bounces).toEqual([true]);
  });

  test('setBadgeCount shows on the dock and caches the value', () => {
    const calls = install(true);
    const a = new App();
    expect(a.setBadgeCount(5)).toBe(true);
    expect(calls.badges.at(-1)).toBe('5');
    expect(a.getBadgeCount()).toBe(5);
    expect(a.badgeCount).toBe(5);
    a.setBadgeCount(0);
    expect(calls.badges.at(-1)).toBe('');
  });

  test('without appKit (non-macOS) the macOS ops are inert but badge caches', () => {
    install(false);
    const a = new App();
    expect(a.dock).toBeUndefined();
    expect(a.isHidden()).toBe(false);
    expect(a.isActive()).toBe(false);
    expect(a.setBadgeCount(9)).toBe(false);
    expect(a.getBadgeCount()).toBe(9);
  });
});

describe('App.applicationMenu', () => {
  test('is null by default', () => {
    resetApplicationMenuForTesting();
    expect(new App().applicationMenu).toBeNull();
  });

  test('the getter delegates to Menu.getApplicationMenu', () => {
    resetApplicationMenuForTesting();
    expect(new App().applicationMenu).toBe(Menu.getApplicationMenu());
  });

  test('assigning null clears the application menu', () => {
    resetApplicationMenuForTesting();
    const a = new App();
    a.applicationMenu = null;
    expect(a.applicationMenu).toBeNull();
    expect(Menu.getApplicationMenu()).toBeNull();
  });
});

describe('App.exit', () => {
  test('calls the environment exit with the given code', () => {
    let code = -1;
    const a = new App();
    a.setEnvironmentForTesting(
      fakeEnv({
        exit: (c) => {
          code = c;
        },
      }),
    );
    a.exit(7);
    expect(code).toBe(7);
  });

  test('defaults the exit code to 0', () => {
    let code = -1;
    const a = new App();
    a.setEnvironmentForTesting(
      fakeEnv({
        exit: (c) => {
          code = c;
        },
      }),
    );
    a.exit();
    expect(code).toBe(0);
  });
});
