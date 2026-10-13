import { afterEach, describe, expect, it, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnsupportedPlatformError } from '../../../../src/common/errors';
import { currentArch } from '../../../../src/common/platform';
import {
  type EngineResolution,
  resetEnginePreparation,
  resetEngineResolution,
} from '../../../../src/main/engine/resolve';
import { createNativeApplication, service } from '../../../../src/main/platform/index';

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

  it("routes 'win32' to the Windows backend without dlopen", () => {
    setPlatform('win32');
    const app = createNativeApplication();
    expect(app).toBeDefined();
    expect(typeof app.createWindow).toBe('function');
  });

  it('throws UnsupportedPlatformError for an unrecognised platform', () => {
    setPlatform('freebsd');
    expect(() => createNativeApplication()).toThrow(UnsupportedPlatformError);
  });
});

const ENGINE_ENV = ['BUNMASKA_ENGINES_PATH', 'BUNMASKA_ENGINE_ID'] as const;

describe('the Blink (cef) engine pin', () => {
  const cefPin: EngineResolution = {
    mode: 'pinned',
    family: 'cef',
    libDir: '/store/cef-154.0.28-154.0.8037.58-bunmaska1-macos-arm64/lib',
    warnings: [],
  };

  afterEach(() => {
    resetEnginePreparation();
  });

  test('picks the Blink backend on macOS without loading the engine', () => {
    setPlatform('darwin');
    const app = createNativeApplication(cefPin);
    expect(typeof app.setUserDataPath).toBe('function');
  });

  test('fails loudly off macOS instead of loading it', () => {
    setPlatform('linux');
    expect(() => createNativeApplication(cefPin)).toThrow(UnsupportedPlatformError);
  });

  test('session rejects on macOS rather than acting on the WebKit store', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bunmaska-blink-'));
    const id = `cef-154.0.28-154.0.8037.58-bunmaska1-macos-${currentArch()}`;
    mkdirSync(join(root, id), { recursive: true });
    writeFileSync(join(root, id, 'INSTALLATION_COMPLETE'), '');
    const saved = new Map(ENGINE_ENV.map((key) => [key, process.env[key]]));
    process.env['BUNMASKA_ENGINES_PATH'] = root;
    process.env['BUNMASKA_ENGINE_ID'] = id;
    setPlatform('darwin');
    resetEngineResolution();
    try {
      await expect(service('session').get().getCookies({})).rejects.toThrow(
        'not wired for the Blink engine',
      );
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      resetEngineResolution();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
