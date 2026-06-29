import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { PreloadBundler } from '../../../src/common/preload-bundle';
import { bundlePreloadAssets, copyAppAssets, isRuntimeAsset } from '../../../src/cli/app-assets';

describe('isRuntimeAsset', () => {
  test('keeps page, preload, styles, images and data', () => {
    expect(isRuntimeAsset('index.html')).toBe(true);
    expect(isRuntimeAsset('preload.js')).toBe(true);
    expect(isRuntimeAsset('styles.css')).toBe(true);
    expect(isRuntimeAsset('icon.png')).toBe(true);
    expect(isRuntimeAsset('data.json')).toBe(true);
  });

  test('excludes TypeScript sources (compiled into the binary)', () => {
    expect(isRuntimeAsset('main.ts')).toBe(false);
    expect(isRuntimeAsset('component.tsx')).toBe(false);
    expect(isRuntimeAsset('mod.mts')).toBe(false);
    expect(isRuntimeAsset('mod.cts')).toBe(false);
  });

  test('excludes node_modules', () => {
    expect(isRuntimeAsset('node_modules')).toBe(false);
  });
});

describe('copyAppAssets', () => {
  test('copies sibling assets, not TS sources or the entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'bunmaska-assets-'));
    const source = join(root, 'src');
    const destination = join(root, 'out');
    mkdirSync(source, { recursive: true });
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(source, 'main.ts'), '// entry');
    writeFileSync(join(source, 'eval.ts'), '// compiled in');
    writeFileSync(join(source, 'preload.js'), '// preload');
    writeFileSync(join(source, 'index.html'), '<!doctype html>');

    const copied = copyAppAssets(join(source, 'main.ts'), destination).sort();

    expect(copied).toEqual(['index.html', 'preload.js']);
    expect(existsSync(join(destination, 'index.html'))).toBe(true);
    expect(existsSync(join(destination, 'preload.js'))).toBe(true);
    expect(existsSync(join(destination, 'main.ts'))).toBe(false);
    expect(existsSync(join(destination, 'eval.ts'))).toBe(false);
  });

  test('returns empty when the entry directory is absent', () => {
    expect(copyAppAssets('/no/such/dir/main.ts', tmpdir())).toEqual([]);
  });
});

describe('bundlePreloadAssets', () => {
  const fakeBundler = (out: string): PreloadBundler => ({ available: true, bundle: () => out });

  test('bundles a module-using preload.js in place and returns it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bunmaska-prebundle-'));
    writeFileSync(
      join(dir, 'preload.js'),
      "import './x.js';\ncontextBridge.exposeInMainWorld('api', {});\n",
    );
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');

    const rewritten = bundlePreloadAssets(
      dir,
      ['preload.js', 'index.html'],
      fakeBundler('(() => {})();'),
    );

    expect(rewritten).toEqual(['preload.js']);
    expect(readFileSync(join(dir, 'preload.js'), 'utf8')).toBe('(() => {})();');
  });

  test('leaves a plain preload and any non-preload asset untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bunmaska-prebundle-'));
    const plain = "contextBridge.exposeInMainWorld('api', {});\n";
    writeFileSync(join(dir, 'preload.js'), plain);
    // A page script that uses import is NOT a preload — it must not be rewritten.
    writeFileSync(join(dir, 'app.js'), "import './x.js';\n");

    const rewritten = bundlePreloadAssets(
      dir,
      ['preload.js', 'app.js'],
      fakeBundler('SHOULD-NOT-APPEAR'),
    );

    expect(rewritten).toEqual([]);
    expect(readFileSync(join(dir, 'preload.js'), 'utf8')).toBe(plain);
    expect(readFileSync(join(dir, 'app.js'), 'utf8')).toBe("import './x.js';\n");
  });
});
