import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PreloadBundler } from '../../../../src/common/preload-bundle';
import { loadPreloadScript } from '../../../../src/main/api/preload';

const tmpPreload = (contents: string, name = 'preload.js'): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-preload-'));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
};

const fakeBundler = (available: boolean, out: string, onBundle?: () => void): PreloadBundler => ({
  available,
  bundle: () => {
    onBundle?.();
    return out;
  },
});

describe('loadPreloadScript', () => {
  test('returns undefined when no preload is configured', () => {
    expect(loadPreloadScript(undefined)).toBeUndefined();
  });

  test('returns a plain-JS preload verbatim, without invoking the bundler', () => {
    let bundled = false;
    const path = tmpPreload("contextBridge.exposeInMainWorld('api', {});\n");
    const result = loadPreloadScript(
      path,
      fakeBundler(true, 'BUNDLED', () => {
        bundled = true;
      }),
    );
    expect(result).toBe("contextBridge.exposeInMainWorld('api', {});\n");
    expect(bundled).toBe(false);
  });

  test('bundles a preload that uses import when a bundler is available', () => {
    const path = tmpPreload(
      "import { greet } from './h.js';\ncontextBridge.exposeInMainWorld('api', { hi: greet });\n",
    );
    expect(loadPreloadScript(path, fakeBundler(true, '(() => {})();'))).toBe('(() => {})();');
  });

  test('throws a clear, non-silent error for an import-using preload with no bundler', () => {
    const path = tmpPreload("import './x.js';\n");
    expect(() => loadPreloadScript(path, fakeBundler(false, ''))).toThrow(/import/i);
  });

  test('throws naming the path when the preload cannot be read', () => {
    expect(() => loadPreloadScript('/no/such/preload.js')).toThrow(/preload/);
  });
});
