import { afterEach, describe, expect, test } from 'bun:test';
import { App } from '../../../../src/main/api/app';
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
import {
  Menu,
  resetApplicationMenuForTesting,
  setMenuRealizerForTesting,
} from '../../../../src/main/api/menu';
import type { AppPathName } from '../../../../src/main/api/app-paths';
import { InvalidArgumentError } from '../../../../src/common/errors';

/** Normalize host separators to POSIX so path comparisons match on any host. */
const slash = (s: string): string => s.replaceAll('\\', '/');

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
      slash(path) === '/proj/package.json'
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

describe('App.isReady', () => {
  test('is false on a fresh instance', () => {
    expect(new App().isReady()).toBe(false);
  });

  test('is true after markReady', () => {
    const a = new App();
    a.markReady();
    expect(a.isReady()).toBe(true);
  });
});

describe('App.markReady', () => {
  test('emits ready exactly once when called multiple times', async () => {
    const a = new App();
    let calls = 0;
    a.on('ready', () => {
      calls += 1;
    });
    a.markReady();
    a.markReady();
    a.markReady();
    await Promise.resolve();
    expect(calls).toBe(1);
  });

  test('emits ready after markReady returns, not inside it', async () => {
    const a = new App();
    const order: string[] = [];
    a.on('ready', () => order.push('ready'));
    a.markReady();
    order.push('returned');
    await Promise.resolve();
    expect(order).toEqual(['returned', 'ready']);
  });

  test('fires a handler registered in the same tick as markReady', async () => {
    const a = new App();
    a.markReady();
    let fired = false;
    a.on('ready', () => {
      fired = true;
    });
    await Promise.resolve();
    expect(fired).toBe(true);
  });

  test('does not fire handlers registered after ready was emitted', async () => {
    const a = new App();
    a.markReady();
    await Promise.resolve();
    let fired = false;
    a.on('ready', () => {
      fired = true;
    });
    await Promise.resolve();
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
    expect(a.isReady()).toBe(true);
  });

  test('rejects instead of throwing when the start hook fails', async () => {
    const a = new App();
    a.setStartHook(() => {
      throw new Error('no display');
    });
    await expect(a.whenReady()).rejects.toThrow('no display');
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
    expect(slash(appWith().getAppPath())).toBe('/proj');
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

  test('setPath rejects a name getPath does not know', () => {
    expect(() => appWith().setPath('bogus' as AppPathName, '/x')).toThrow(InvalidArgumentError);
  });

  test('setPath rejects a relative path', () => {
    expect(() => appWith().setPath('userData', 'data')).toThrow(InvalidArgumentError);
  });

  test('Linux user folders come from xdg-user-dirs', () => {
    const userDirs =
      '# written by xdg-user-dirs-update\nXDG_DOWNLOAD_DIR="$HOME/Téléchargements"\n';
    const a = appWith({
      platform: 'linux',
      home: '/home/ada',
      readFile: (path) =>
        slash(path) === '/home/ada/.config/user-dirs.dirs' ? userDirs : undefined,
    });
    expect(a.getPath('downloads')).toBe('/home/ada/Téléchargements');
  });

  test('setAppLogsPath without a path restores the platform default', () => {
    const a = appWith();
    a.setAppLogsPath('/var/log/custom');
    a.setAppLogsPath();
    expect(a.getPath('logs')).toBe('/Users/ada/Library/Logs/Demo App');
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
    expect(
      appWith({
        platform: 'linux',
        env: { LANGUAGE: 'fr_FR:en_US' },
      }).getPreferredSystemLanguages(),
    ).toEqual(['fr-FR', 'en-US']);
  });
});

describe('App.isPackaged', () => {
  test('is false under the dev runner', () => {
    expect(appWith({ execPath: '/opt/homebrew/bin/bun' }).isPackaged).toBe(false);
  });

  test('is true inside a compiled binary', () => {
    expect(appWith({ mainScript: '/$bunfs/root/Demo' }).isPackaged).toBe(true);
  });
});

describe('App.relaunch', () => {
  /** Relaunch with default args while `process.argv` is `argv`; returns the args passed on. */
  const relaunchArgs = (argv: string[], mainScript: string): string[] => {
    const calls: string[][] = [];
    const a = appWith({ mainScript, relaunch: (_execPath, args) => calls.push(args) });
    const saved = process.argv;
    process.argv = argv;
    try {
      a.relaunch();
    } finally {
      process.argv = saved;
    }
    return calls[0] ?? [];
  };

  test('keeps the script path under the dev runner', () => {
    const argv = ['/opt/homebrew/bin/bun', '/proj/src/main.ts', '--flag'];
    expect(relaunchArgs(argv, '/proj/src/main.ts')).toEqual(['/proj/src/main.ts', '--flag']);
  });

  test('drops the embedded entry path in a compiled binary', () => {
    const argv = ['bun', '/$bunfs/root/Demo', '--flag'];
    expect(relaunchArgs(argv, '/$bunfs/root/Demo')).toEqual(['--flag']);
  });

  test('relaunches with the env execPath', () => {
    const calls: string[] = [];
    appWith({ execPath: '/bin/myapp', relaunch: (execPath) => calls.push(execPath) }).relaunch();
    expect(calls).toEqual(['/bin/myapp']);
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
  /** A primary manager over a fake backend; `deliver` plays a peer's message. */
  const primary = (): { manager: SingleInstanceManager; deliver: (json: string) => void } => {
    let onMessage: ((json: string) => void) | undefined;
    const backend: LockBackend = {
      tryCreateLock: () => true,
      readLockPid: () => undefined,
      isAlive: () => false,
      clearLock: () => undefined,
      startServer: (_path, cb) => {
        onMessage = cb;
      },
      notify: () => undefined,
      stop: () => undefined,
    };
    return {
      manager: new SingleInstanceManager(backend, { lockPath: '/l', socketPath: '/s', pid: 1 }),
      deliver: (json) => onMessage?.(json),
    };
  };

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  test('emits second-instance with argv/cwd/data when a peer connects', async () => {
    const a = new App();
    a.markReady();
    const fixture = primary();
    a.setSingleInstanceForTesting(fixture.manager);
    let captured: { argv: string[]; cwd: string; data: unknown } | undefined;
    a.on('second-instance', (_event: unknown, argv: string[], cwd: string, data: unknown) => {
      captured = { argv, cwd, data };
    });
    a.requestSingleInstanceLock();
    fixture.deliver(encodePayload({ argv: ['p', 'q'], cwd: '/peer', additionalData: { z: 1 } }));
    expect(captured).toBeUndefined();
    await flush();
    expect(captured).toEqual({ argv: ['p', 'q'], cwd: '/peer', data: { z: 1 } });
  });

  test('holds second-instance until after ready', async () => {
    const a = new App();
    const fixture = primary();
    a.setSingleInstanceForTesting(fixture.manager);
    const order: string[] = [];
    a.on('ready', () => order.push('ready'));
    a.on('second-instance', () => order.push('second-instance'));
    a.requestSingleInstanceLock();
    fixture.deliver(encodePayload({ argv: [], cwd: '/peer', additionalData: undefined }));
    await flush();
    a.markReady();
    await flush();
    expect(order).toEqual(['ready', 'second-instance']);
  });
});

describe('App macOS desktop integration', () => {
  type DesktopCalls = { badges: string[]; bounces: boolean[] };

  /** Install a fake native app (optionally with macOS appKit) and record calls. */
  const install = (withAppKit: boolean): DesktopCalls => {
    const calls: DesktopCalls = { badges: [], bounces: [] };
    let dockBadge = '';
    const appKit: NativeAppKit = {
      setActivationPolicy: () => undefined,
      hide: () => undefined,
      show: () => undefined,
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
      ...(withAppKit ? { appKit } : {}),
    };
    setNativeAppForTesting(native);
    return calls;
  };

  afterEach(() => setNativeAppForTesting(undefined));

  test('isHidden/isActive reflect appKit', () => {
    install(true);
    const a = new App();
    expect(a.isHidden()).toBe(true);
    expect(a.isActive()).toBe(true);
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
  afterEach(() => {
    setMenuRealizerForTesting(undefined);
    resetApplicationMenuForTesting();
  });

  test('reads back the menu it was assigned, then null once cleared', () => {
    setMenuRealizerForTesting({ realize: () => 1n, setApplicationMenu: () => undefined });
    const a = new App();
    const menu = new Menu();
    a.applicationMenu = menu;
    expect(a.applicationMenu).toBe(menu);
    a.applicationMenu = null;
    expect(a.applicationMenu).toBeNull();
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
