import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rendererOutDir } from '../../../src/common/config-schema';
import { buildRenderer } from '../../../src/cli/renderer-build';

const makeProject = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-renderer-'));
  mkdirSync(join(dir, 'src', 'renderer'), { recursive: true });
  writeFileSync(join(dir, 'src', 'renderer', 'main.ts'), "document.title = 'built';\n");
  writeFileSync(join(dir, 'src', 'renderer', 'index.html'), '<!doctype html><body></body>\n');
  return dir;
};

describe('rendererOutDir', () => {
  test('defaults to dist/renderer', () => {
    expect(rendererOutDir({ entry: 'src/renderer/main.ts' })).toBe('dist/renderer');
    expect(rendererOutDir({ entry: 'e', outDir: 'out/r' })).toBe('out/r');
  });
});

describe('buildRenderer', () => {
  test('bundles the entry as a classic IIFE with dev NODE_ENV', async () => {
    const dir = makeProject();
    const result = await buildRenderer(dir, { entry: 'src/renderer/main.ts' });
    expect(result.written).toContain('main.js');
    const bundle = readFileSync(join(result.outDir, 'main.js'), 'utf8');
    // A module bundle would carry import/export; file:// cannot load those.
    expect(bundle).not.toContain('export ');
    expect(bundle).not.toMatch(/^import /m);
  });

  test('copies the configured static files into the output', async () => {
    const dir = makeProject();
    const result = await buildRenderer(dir, {
      entry: 'src/renderer/main.ts',
      copy: ['src/renderer/index.html'],
    });
    expect(result.written).toContain('index.html');
    expect(readFileSync(join(result.outDir, 'index.html'), 'utf8')).toContain('<!doctype html>');
  });

  test('throws a named error for a missing entry or copy source', async () => {
    const dir = makeProject();
    await expect(buildRenderer(dir, { entry: 'src/renderer/nope.ts' })).rejects.toThrow(
      /renderer.entry not found/,
    );
    await expect(
      buildRenderer(dir, { entry: 'src/renderer/main.ts', copy: ['missing.html'] }),
    ).rejects.toThrow(/renderer.copy source not found/);
  });
});
