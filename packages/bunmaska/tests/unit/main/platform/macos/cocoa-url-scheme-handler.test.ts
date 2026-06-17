import { afterEach, describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../../../src/common/platform';
import {
  createUrlSchemeHandler,
  handleStartTask,
  setUrlSchemeDispatcherForTesting,
} from '../../../../../src/main/platform/macos/cocoa-url-scheme-handler';

/**
 * Host-safe unit tests for the macOS `WKURLSchemeHandler` module.
 *
 * The IMP cannot be invoked without a real `WKURLSchemeTask`, so the end-to-end
 * serve path is proven by the macOS integration test. Here we assert the module
 * exports the expected seam and that the injectable dispatcher is wired (so a
 * test can substitute the serve/decline decision).
 */

afterEach(() => {
  setUrlSchemeDispatcherForTesting(undefined);
});

describe('cocoa-url-scheme-handler exports', () => {
  test('createUrlSchemeHandler is a function', () => {
    expect(typeof createUrlSchemeHandler).toBe('function');
  });

  test('handleStartTask is a function', () => {
    expect(typeof handleStartTask).toBe('function');
  });

  test('setUrlSchemeDispatcherForTesting is a function', () => {
    expect(typeof setUrlSchemeDispatcherForTesting).toBe('function');
  });
});

// macOS-only: handleStartTask drives the ObjC runtime (to read the task's URL),
// which is unavailable off macOS — on Linux it bails to the decline path without
// reaching the dispatcher, so this seam test must run on macOS only.
describe.skipIf(currentPlatform() !== 'macos')('dispatcher injection seam', () => {
  test('a substituted dispatcher receiving a null task url declines without throwing', () => {
    let seen: string | undefined;
    setUrlSchemeDispatcherForTesting((url) => {
      seen = url;
      return undefined;
    });
    // task = 0n: on macOS requestUrlOf returns '' (the dispatcher is still called
    // with the empty url); the decline path (failTask) is best-effort.
    expect(() => handleStartTask(0n)).not.toThrow();
    expect(seen).toBe('');
  });
});
