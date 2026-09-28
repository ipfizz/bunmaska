import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { devClassifier } from '../../../src/cli/index';

const DIR = resolve('/proj');
const silent = (): void => undefined;

describe('devClassifier', () => {
  test.each([
    ['src/renderer/main.tsx'],
    ['./src/renderer/main.tsx'],
    [join(DIR, 'src/renderer/main.tsx')],
  ])('entry %s rebuilds on a renderer source edit', (entry) => {
    const classify = devClassifier(DIR, { renderer: { entry } }, silent);
    expect(classify('src/renderer/App.tsx')).toBe('rebuild');
    expect(classify('src/main.ts')).toBe('restart');
  });

  test('an outDir inside the renderer dir reloads on its output writes', () => {
    const renderer = { entry: 'src/renderer/main.tsx', outDir: 'src/renderer/dist' };
    const classify = devClassifier(DIR, { renderer }, silent);
    expect(classify('src/renderer/dist/main.js')).toBe('reload');
    expect(classify('src/renderer/App.tsx')).toBe('rebuild');
  });

  test('a config edit asks for a dev restart instead of a stale child restart', () => {
    const logged: string[] = [];
    const classify = devClassifier(DIR, {}, (message) => logged.push(message));
    expect(classify('bunmaska.config.ts')).toBe('ignore');
    expect(logged.join('\n')).toContain('restart bunmaska dev');
  });
});
