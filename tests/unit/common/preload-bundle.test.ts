import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPreloadBundler, usesModuleSyntax } from '../../../src/common/preload-bundle';

describe('usesModuleSyntax', () => {
  test('detects a top-level import or export', () => {
    expect(usesModuleSyntax("import x from './x.js';")).toBe(true);
    expect(usesModuleSyntax("import './side-effect.js';")).toBe(true);
    expect(usesModuleSyntax('export const a = 1;')).toBe(true);
    expect(usesModuleSyntax("  import { a } from 'b';")).toBe(true);
  });

  test('does not flag plain preloads or the word "import" mid-line', () => {
    expect(usesModuleSyntax("contextBridge.exposeInMainWorld('api', { ok: () => 1 });")).toBe(
      false,
    );
    expect(usesModuleSyntax('const important = 1;')).toBe(false);
    expect(usesModuleSyntax('foo.import = 1;')).toBe(false);
    expect(usesModuleSyntax('// import x from "y";')).toBe(false);
  });
});

describe('defaultPreloadBundler (real Bun bundler)', () => {
  test('inlines an imported module into a single classic IIFE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bunmaska-preload-real-'));
    writeFileSync(join(dir, 'helper.js'), "export const greet = () => 'hi from helper';\n");
    const path = join(dir, 'preload.js');
    writeFileSync(
      path,
      "import { greet } from './helper.js';\ncontextBridge.exposeInMainWorld('api', { hi: () => greet() });\n",
    );
    // bun test runs under the Bun CLI, so the bundler is available here.
    expect(defaultPreloadBundler.available).toBe(true);
    const out = defaultPreloadBundler.bundle(path);
    expect(out).toContain('hi from helper');
    // No surviving top-level module syntax, and the `contextBridge` global is left free.
    expect(usesModuleSyntax(out)).toBe(false);
    expect(out).toContain('contextBridge.exposeInMainWorld');
  });
});
