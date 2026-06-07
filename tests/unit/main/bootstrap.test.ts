import { afterEach, describe, expect, test } from 'bun:test';
import { app } from '../../../src/main/api/app';
import { ensureNativeStarted, resetBootstrapForTesting } from '../../../src/main/bootstrap';
import { setNativeAppForTesting } from '../../../src/main/native-app';
import type { NativeApplication } from '../../../src/main/platform/native';
import { installSafeAppExit } from '../../helpers/safe-app-exit';

/** A fake native app exposing a trigger for its registered activate callback. */
const makeNative = (): { native: NativeApplication; activate: (v: boolean) => void } => {
  let cb: ((v: boolean) => void) | undefined;
  const native: NativeApplication = {
    start: () => undefined,
    onReady: (ready) => ready(),
    createWindow: () => {
      throw new Error('createWindow not used in bootstrap tests');
    },
    quit: () => undefined,
    onActivate: (c) => {
      cb = c;
    },
  };
  return { native, activate: (v) => cb?.(v) };
};

describe('bootstrap native wiring', () => {
  afterEach(() => {
    setNativeAppForTesting(undefined);
    app.resetForTesting();
    resetBootstrapForTesting();
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
});
