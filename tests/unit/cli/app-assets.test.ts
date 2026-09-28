import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { PreloadBundler } from '../../../src/common/preload-bundle';
import {
  bundlePreloadAssets,
  copyAppAssets,
  isRuntimeAsset,
  writeAppManifest,
} from '../../../src/cli/app-assets';
import {
  readManifest,
  resolveAppName,
  resolveAppVersion,
} from '../../../src/main/api/app-metadata';

describe('isRuntimeAsset', () => {
  test('keeps page, preload, styles, images and data', () => {
    for (const name of ['index.html', 'preload.js', 'styles.css', 'icon.PNG', 'data.json']) {
      expect(isRuntimeAsset(name)).toBe(true);
    }
  });

  test('rejects sources, keys, lockfiles and build outputs', () => {
    for (const name of [
      'main.ts',
      'component.tsx',
      'update-signing-key.pem',
      'app.key',
      'cert.p12',
      'bun.lock',
      'App-linux-x64.tar.gz',
      'app_1.0.0_amd64.deb',
      'app-stable-macos-arm64.tar.zst',
      'node_modules',
    ]) {
      expect(isRuntimeAsset(name)).toBe(false);
    }
  });
});

describe('writeAppManifest', () => {
  const read = (path: string): string | undefined =>
    existsSync(path) ? readFileSync(path, 'utf8') : undefined;

  /** What a compiled app built as 'Notes App' 2.0.1 from `project`'s package.json reads back. */
  const built = (project?: object) => {
    const root = mkdtempSync(join(tmpdir(), 'bunmaska-manifest-'));
    const destination = join(root, 'out');
    mkdirSync(destination);
    if (project !== undefined) {
      writeFileSync(join(root, 'package.json'), JSON.stringify(project));
    }
    writeAppManifest(destination, join(root, 'main.ts'), 'Notes App', '2.0.1');
    return readManifest(destination, read);
  };

  test("keeps the project's own name, so app.getName() and userData match dev", () => {
    expect(resolveAppName(built({ name: 'notes', version: '9.9.9' }))).toBe('notes');
    expect(resolveAppName(built({ name: 'notes', productName: 'Notes' }))).toBe('Notes');
    expect(resolveAppVersion(built({ name: 'notes', version: '9.9.9' }))).toBe('2.0.1');
  });

  test('falls back to the build name when the project names nothing', () => {
    expect(resolveAppName(built())).toBe('Notes App');
    expect(resolveAppVersion(built())).toBe('2.0.1');
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

  test('never ships keys, dotfiles, nested sources or earlier build outputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'bunmaska-assets-'));
    const destination = join(root, 'out');
    mkdirSync(join(root, 'lib', '.cache'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
    mkdirSync(destination, { recursive: true });
    for (const name of [
      'main.ts',
      'index.html',
      'update-signing-key.pem',
      '.env',
      'bun.lock',
      'App-linux-x64.tar.gz',
      'lib/secret.ts',
      'lib/style.css',
      'lib/.cache/page.html',
      'node_modules/x/index.js',
    ]) {
      writeFileSync(join(root, name), 'x');
    }

    const copied = copyAppAssets(join(root, 'main.ts'), destination).sort();

    expect(copied).toEqual(['index.html', 'lib']);
    expect(readdirSync(destination, { recursive: true }).sort()).toEqual([
      'index.html',
      'lib',
      join('lib', 'style.css'),
    ]);
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
      join(dir, 'main.ts'),
      dir,
      ['preload.js', 'index.html'],
      fakeBundler('(() => {})();'),
    );

    expect(rewritten).toEqual(['preload.js']);
    expect(readFileSync(join(dir, 'preload.js'), 'utf8')).toBe('(() => {})();');
  });

  test('resolves preload imports from the source directory, not the copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'bunmaska-prebundle-'));
    const source = join(root, 'src');
    const destination = join(root, 'out');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'main.ts'), '// entry');
    writeFileSync(join(source, 'helper.ts'), "export const greet = () => 'hi-from-helper';\n");
    writeFileSync(
      join(source, 'preload.js'),
      "import { greet } from './helper.ts';\nglobalThis.greeting = greet();\n",
    );
    const entry = join(source, 'main.ts');

    const rewritten = bundlePreloadAssets(entry, destination, copyAppAssets(entry, destination));

    expect(rewritten).toEqual(['preload.js']);
    expect(readFileSync(join(destination, 'preload.js'), 'utf8')).toContain('hi-from-helper');
  });

  test('leaves a plain preload and any non-preload asset untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bunmaska-prebundle-'));
    const plain = "contextBridge.exposeInMainWorld('api', {});\n";
    writeFileSync(join(dir, 'preload.js'), plain);
    // A page script that uses import is not a preload, so it is left alone.
    writeFileSync(join(dir, 'app.js'), "import './x.js';\n");

    const rewritten = bundlePreloadAssets(
      join(dir, 'main.ts'),
      dir,
      ['preload.js', 'app.js'],
      fakeBundler('SHOULD-NOT-APPEAR'),
    );

    expect(rewritten).toEqual([]);
    expect(readFileSync(join(dir, 'preload.js'), 'utf8')).toBe(plain);
    expect(readFileSync(join(dir, 'app.js'), 'utf8')).toBe("import './x.js';\n");
  });
});
