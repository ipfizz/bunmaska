import { afterEach, describe, expect, it } from 'bun:test';
import { UnsupportedPlatformError } from '../../../../src/common/errors';
import { createNativeApplication } from '../../../../src/main/platform/index';

/**
 * Dispatcher routing tests.
 *
 * `createNativeApplication` resolves the platform at call time via
 * `currentPlatform()`, which reads `process.platform`. Overriding that single
 * property drives each branch on any dev host without `mock.module` (whose
 * module-graph patch would leak into other test files). Both backends' FFI
 * loaders are lazy — constructing the application object does not `dlopen` — so
 * the 'linux' branch is safe to exercise off-Linux.
 */

const original = Object.getOwnPropertyDescriptor(process, 'platform');

const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value, configurable: true });
};

afterEach(() => {
  if (original) {
    Object.defineProperty(process, 'platform', original);
  }
});

describe('createNativeApplication dispatcher', () => {
  it("routes 'linux' to the Linux backend without dlopen", () => {
    setPlatform('linux');
    const app = createNativeApplication();
    expect(app).toBeDefined();
    expect(typeof app.start).toBe('function');
    expect(typeof app.createWindow).toBe('function');
    expect(typeof app.quit).toBe('function');
  });

  it("routes 'darwin' to the macOS backend", () => {
    setPlatform('darwin');
    const app = createNativeApplication();
    expect(app).toBeDefined();
    expect(typeof app.createWindow).toBe('function');
  });

  it('throws UnsupportedPlatformError for unsupported platforms', () => {
    setPlatform('win32');
    expect(() => createNativeApplication()).toThrow(UnsupportedPlatformError);
  });
});
