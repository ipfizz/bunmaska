import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { rendererClassifier } from '../../../src/cli/index';

const DIR = resolve('/proj');

describe('rendererClassifier', () => {
  test.each([
    ['src/renderer/main.tsx'],
    ['./src/renderer/main.tsx'],
    [join(DIR, 'src/renderer/main.tsx')],
  ])('entry %s rebuilds on a renderer source edit', (entry) => {
    const classify = rendererClassifier(DIR, { entry });
    expect(classify('src/renderer/App.tsx')).toBe('rebuild');
    expect(classify('src/main.ts')).toBe('restart');
  });

  test('an outDir inside the renderer dir reloads on its output writes', () => {
    const classify = rendererClassifier(DIR, {
      entry: 'src/renderer/main.tsx',
      outDir: 'src/renderer/dist',
    });
    expect(classify('src/renderer/dist/main.js')).toBe('reload');
    expect(classify('src/renderer/App.tsx')).toBe('rebuild');
  });
});
