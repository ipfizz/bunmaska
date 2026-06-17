import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../../src/main/api/app';
import { nativeTheme } from '../../../src/main/api/native-theme';
import { powerMonitor } from '../../../src/main/api/power-monitor';
import { ensureNativeStarted, resetBootstrapForTesting } from '../../../src/main/bootstrap';
import { setNativeAppForTesting } from '../../../src/main/native-app';
import type { NativeApplication } from '../../../src/main/platform/native';
import { installSafeAppExit } from '../../helpers/safe-app-exit';

type NativeTriggers = {
  native: NativeApplication;
  activate: (v: boolean) => void;
  openUrl: (url: string) => void;
  openFile: (path: string) => void;
};

/** A fake native app exposing triggers for its registered lifecycle callbacks. */
const makeNative = (): NativeTriggers => {
  let activateCb: ((v: boolean) => void) | undefined;
  let openUrlCb: ((url: string) => void) | undefined;
  let openFileCb: ((path: string) => void) | undefined;
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
  };
  return {
    native,
    activate: (v) => activateCb?.(v),
    openUrl: (url) => openUrlCb?.(url),
    openFile: (path) => openFileCb?.(path),
  };
};

describe('bootstrap native wiring', () => {
  beforeEach(() => {
    // Pre-arm the once-guards with no-ops so the synthetic `onReady` below does
    // not drive the real native OS observers (FFI) during a unit test.
    nativeTheme.startObserving(() => undefined);
    powerMonitor.startObserving(() => undefined);
  });

  afterEach(() => {
    setNativeAppForTesting(undefined);
    app.resetForTesting();
    resetBootstrapForTesting();
    nativeTheme.resetObservingForTesting();
    powerMonitor.resetObservingForTesting();
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
    expect(app.isReady).toBe(true);
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
