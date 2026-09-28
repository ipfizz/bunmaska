import { describe, expect, test } from 'bun:test';
import { classifyChange, devClassifier } from '../../../src/cli/dev-classify';
import { tempProject } from '../../helpers/temp-project';

describe('classifyChange', () => {
  test('restarts on a TypeScript (main-process) change', () => {
    expect(classifyChange('src/main.ts')).toBe('restart');
    expect(classifyChange('src/window.tsx')).toBe('restart');
    expect(classifyChange('bunmaska.config.ts')).toBe('restart');
  });

  test('live-reloads on a renderer asset change', () => {
    expect(classifyChange('src/index.html')).toBe('reload');
    expect(classifyChange('src/styles.css')).toBe('reload');
  });

  test('restarts on a preload change, which a reload cannot pick up', () => {
    // The preload is bundled at window construction; a reload re-injects the stale one.
    expect(classifyChange('src/preload.js')).toBe('restart');
    expect(classifyChange('app/preload.cjs')).toBe('restart');
  });

  test('reloads on a renderer bundle under dist', () => {
    // An ignored dist would keep a rebuilt renderer from ever reaching the window.
    expect(classifyChange('dist/renderer/assets/app.js')).toBe('reload');
    expect(classifyChange('dist/renderer/index.html')).toBe('reload');
  });

  test('ignores dependency/VCS dirs and dotfiles', () => {
    expect(classifyChange('node_modules/x/index.js')).toBe('ignore');
    expect(classifyChange('.git/HEAD')).toBe('ignore');
    expect(classifyChange('src/.main.ts.swp')).toBe('ignore');
    expect(classifyChange('')).toBe('ignore');
  });

  test('ignores the app bundles bunmaska build writes into the project root', () => {
    expect(classifyChange('MyApp.app/Contents/MacOS/index.html')).toBe('ignore');
    expect(classifyChange('build/x.js')).toBe('ignore');
    expect(classifyChange('out/x.js')).toBe('ignore');
  });

  test('watches source folders that merely share a build-output name', () => {
    expect(classifyChange('src/build/config.ts')).toBe('restart');
    expect(classifyChange('src/renderer/out/x.tsx', 'src/renderer')).toBe('rebuild');
  });

  test('ignores tool state in dot directories', () => {
    // JetBrains rewrites .idea/workspace.xml on focus changes.
    expect(classifyChange('.idea/workspace.xml')).toBe('ignore');
    expect(classifyChange('.vscode/generated.ts')).toBe('ignore');
  });
});

describe('classifyChange with a renderer root', () => {
  test('a source change under the renderer root rebuilds instead of restarting', () => {
    expect(classifyChange('src/renderer/App.tsx', 'src/renderer')).toBe('rebuild');
    expect(classifyChange('src/renderer/styles.css', 'src/renderer')).toBe('rebuild');
  });

  test('a main-process source outside the renderer root still restarts', () => {
    expect(classifyChange('src/main.ts', 'src/renderer')).toBe('restart');
    expect(classifyChange('bunmaska.config.ts', 'src/renderer')).toBe('restart');
  });

  test('the renderer output under dist still plain-reloads', () => {
    expect(classifyChange('dist/renderer/main.js', 'src/renderer')).toBe('reload');
  });

  test('a ./-prefixed renderer root matches like a bare one', () => {
    expect(classifyChange('src/renderer/App.tsx', './src/renderer')).toBe('rebuild');
  });

  test('a preload under the renderer root still restarts', () => {
    expect(classifyChange('src/renderer/preload.js', 'src/renderer')).toBe('restart');
  });
});

describe('devClassifier', () => {
  test('a renderer.copy source rebuilds so dist gets the new copy', () => {
    // Its dist copy then reloads the window, or restarts the app for a preload.
    const classify = devClassifier('/proj', 'src/main.ts', {
      entry: 'src/renderer/main.ts',
      copy: ['src/index.html', 'src/preload.js', 'assets'],
    });
    expect(classify('src/index.html')).toBe('rebuild');
    expect(classify('src/preload.js')).toBe('rebuild');
    expect(classify('assets/sfx/jump.ogg')).toBe('rebuild');
    expect(classify('dist/renderer/preload.js')).toBe('restart');
    expect(classify('src/main.ts')).toBe('restart');
  });

  test('a JavaScript module the entry imports restarts; other scripts reload', () => {
    using p = tempProject({
      'main.js': "const ipc = require('./ipc.js');",
      'ipc.js': 'module.exports = {};',
      'renderer.js': 'document.title = "x";',
    });
    const classify = devClassifier(p.dir, 'main.js');
    expect(classify('main.js')).toBe('restart');
    expect(classify('ipc.js')).toBe('restart');
    expect(classify('renderer.js')).toBe('reload');
  });

  test('in a flat layout a main module under the renderer root restarts', () => {
    using p = tempProject({
      'src/main.ts': "import { load } from './state';\nload();",
      'src/state.ts': 'export const load = () => 1;',
      'src/index.tsx': "import { App } from './App';\nApp();",
      'src/App.tsx': 'export const App = () => null;',
    });
    const classify = devClassifier(p.dir, 'src/main.ts', { entry: 'src/index.tsx' });
    expect(classify('src/main.ts')).toBe('restart');
    expect(classify('src/state.ts')).toBe('restart');
    expect(classify('src/App.tsx')).toBe('rebuild');
  });

  test('an import added to a main module is tracked from its next edit', () => {
    using p = tempProject({ 'main.js': '', 'late.js': '' });
    const classify = devClassifier(p.dir, 'main.js');
    expect(classify('late.js')).toBe('reload');
    p.write('main.js', "require('./late.js');");
    expect(classify('main.js')).toBe('restart');
    expect(classify('late.js')).toBe('restart');
  });
});
