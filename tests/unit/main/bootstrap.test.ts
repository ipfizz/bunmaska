import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { app } from '../../../src/main/api/app';
import {
  Menu,
  resetApplicationMenuForTesting,
  setMenuRealizerForTesting,
} from '../../../src/main/api/menu';
import { resetNativeThemeObservingForTesting } from '../../../src/main/api/native-theme';
import { resetPowerMonitorObservingForTesting } from '../../../src/main/api/power-monitor';
import { ensureNativeStarted, resetBootstrapForTesting } from '../../../src/main/bootstrap';
import { setNativeAppForTesting } from '../../../src/main/native-app';
import type { NativeApplication } from '../../../src/main/platform/native';
import { armInertObservers, inertMenuRealizer } from '../../helpers/inert-observers';
import { installSafeAppExit } from '../../helpers/safe-app-exit';

type NativeTriggers = {
  native: NativeApplication;
  activate: (v: boolean) => void;
  openUrl: (url: string) => void;
  openFile: (path: string) => void;
  quitRequest: () => void;
};

/** A fake native app exposing triggers for its registered lifecycle callbacks. */
const makeNative = (): NativeTriggers => {
  let activateCb: ((v: boolean) => void) | undefined;
  let openUrlCb: ((url: string) => void) | undefined;
  let openFileCb: ((path: string) => void) | undefined;
  let quitRequestCb: (() => void) | undefined;
  const native: NativeApplication = {
    start: () => undefined,
    onReady: (ready) => ready(),
    createWindow: () => {
      throw new Error('createWindow not used in bootstrap tests');
    },
    quit: () => undefined,
    onActivate: (c) => {
      activateCb = c;
    },
    onOpenUrl: (c) => {
      openUrlCb = c;
    },
    onOpenFile: (c) => {
      openFileCb = c;
    },
    onQuitRequest: (c) => {
      quitRequestCb = c;
    },
  };
  return {
    native,
    activate: (v) => activateCb?.(v),
    openUrl: (url) => openUrlCb?.(url),
    openFile: (path) => openFileCb?.(path),
    quitRequest: () => quitRequestCb?.(),
  };
};

describe('bootstrap native wiring', () => {
  beforeEach(() => {
    armInertObservers();
    setMenuRealizerForTesting(inertMenuRealizer);
  });

  afterEach(() => {
    setMenuRealizerForTesting(undefined);
    resetApplicationMenuForTesting();
    setNativeAppForTesting(undefined);
    app.resetForTesting();
    resetBootstrapForTesting();
    resetNativeThemeObservingForTesting();
    resetPowerMonitorObservingForTesting();
  });

  test('an OS quit request runs app.quit on a later tick, never inside the native callback', async () => {
    app.resetForTesting();
    resetBootstrapForTesting();
    installSafeAppExit();
    const triggers = makeNative();
    setNativeAppForTesting(triggers.native);
    ensureNativeStarted();
    let beforeQuit = 0;
    const veto = (event: { preventDefault(): void }): void => {
      beforeQuit += 1;
      event.preventDefault();
    };
    app.on('before-quit', veto);
    try {
      triggers.quitRequest();
      expect(beforeQuit).toBe(0);
      for (let tick = 0; tick < 50 && beforeQuit === 0; tick += 1) {
        await Bun.sleep(2);
      }
      expect(beforeQuit).toBe(1);
    } finally {
      app.removeListener('before-quit', veto);
    }
  });

  test('forwards native activate to the app activate event with hasVisibleWindows', () => {
    installSafeAppExit();
    const { native, activate } = makeNative();
    resetBootstrapForTesting();
    setNativeAppForTesting(native);
    ensureNativeStarted();
    let seen: boolean | undefined;
    app.on('activate', (_event: unknown, hasVisibleWindows: boolean) => {
      seen = hasVisibleWindows;
    });
    activate(true);
    expect(seen).toBe(true);
  });

  test('marks the app ready once the native app signals ready', () => {
    installSafeAppExit();
    const { native } = makeNative();
    resetBootstrapForTesting();
    setNativeAppForTesting(native);
    ensureNativeStarted();
    expect(app.isReady()).toBe(true);
  });

  test.skipIf(currentPlatform() !== 'macos')(
    'installs the default application menu once the native app is ready on macOS',
    () => {
      installSafeAppExit();
      resetBootstrapForTesting();
      setNativeAppForTesting(makeNative().native);
      ensureNativeStarted();
      expect(Menu.getApplicationMenu()?.items[0]?.label).toBe(app.name);
    },
  );

  test('retries the native start after a failed one', () => {
    const { native } = makeNative();
    let starts = 0;
    resetBootstrapForTesting();
    setNativeAppForTesting({
      ...native,
      start: () => {
        starts += 1;
        if (starts === 1) {
          throw new Error('no display');
        }
      },
    });
    expect(() => ensureNativeStarted()).toThrow('no display');
    ensureNativeStarted();
    expect(starts).toBe(2);
  });

  test('a bare ready listener starts the native app after the current tick', async () => {
    const { native } = makeNative();
    let starts = 0;
    resetBootstrapForTesting();
    setNativeAppForTesting({ ...native, start: () => (starts += 1) });
    const listener = (): void => undefined;
    app.on('ready', listener);
    try {
      expect(starts).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(starts).toBe(1);
    } finally {
      app.removeListener('ready', listener);
    }
  });

  test('forwards native open-url to the app open-url event', () => {
    installSafeAppExit();
    const { native, openUrl } = makeNative();
    resetBootstrapForTesting();
    setNativeAppForTesting(native);
    ensureNativeStarted();
    let seen: string | undefined;
    app.on('open-url', (_event: unknown, url: string) => {
      seen = url;
    });
    openUrl('myapp://deep/link');
    expect(seen).toBe('myapp://deep/link');
  });

  test('forwards native open-file to the app open-file event', () => {
    installSafeAppExit();
    const { native, openFile } = makeNative();
    resetBootstrapForTesting();
    setNativeAppForTesting(native);
    ensureNativeStarted();
    let seen: string | undefined;
    app.on('open-file', (_event: unknown, path: string) => {
      seen = path;
    });
    openFile('/Users/ada/doc.txt');
    expect(seen).toBe('/Users/ada/doc.txt');
  });
});

describe('bootstrap quit wiring', () => {
  afterEach(() => {
    setNativeAppForTesting(undefined);
    app.resetForTesting();
    resetBootstrapForTesting();
  });

  const withCountingNative = (): { quits: () => number } => {
    let quits = 0;
    const { native } = makeNative();
    setNativeAppForTesting({
      ...native,
      quit: () => {
        quits += 1;
      },
    });
    installSafeAppExit();
    ensureNativeStarted();
    return { quits: () => quits };
  };

  test('a will-quit veto leaves the native run loop running', () => {
    const counting = withCountingNative();
    const veto = (event: { preventDefault(): void }): void => {
      event.preventDefault();
    };
    app.on('will-quit', veto);
    try {
      app.quit();
      expect(counting.quits()).toBe(0);
    } finally {
      app.removeListener('will-quit', veto);
    }
  });

  test('a completed quit stops the native run loop once', () => {
    const counting = withCountingNative();
    app.quit();
    expect(counting.quits()).toBe(1);
  });
});
