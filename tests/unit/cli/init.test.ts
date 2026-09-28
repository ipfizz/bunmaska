import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  deriveProjectName,
  initTemplateFiles,
  runInit,
  type ScaffoldDeps,
  type ScaffoldFile,
  scaffoldProject,
} from '../../../src/cli/init';

// Normalize host path separators so assertions hold on both POSIX and Windows.
const slash = (s: string): string => s.replaceAll('\\', '/');

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-init-'));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const memoryDeps = (): { deps: ScaffoldDeps; files: Map<string, string> } => {
  const files = new Map<string, string>();
  return {
    files,
    deps: {
      exists: (path) => files.has(path),
      mkdir: () => undefined,
      writeFile: (path, contents) => {
        files.set(path, contents);
      },
    },
  };
};

describe('initTemplateFiles', () => {
  const files = initTemplateFiles({ name: 'My App', id: 'com.example.my-app' });
  const byPath = new Map(files.map((f) => [f.path, f.contents]));

  test('includes the core project files', () => {
    for (const path of [
      'package.json',
      'bunmaska.config.ts',
      'src/main.ts',
      'src/preload.js',
      'src/index.html',
      '.gitignore',
      'README.md',
    ]) {
      expect(byPath.has(path)).toBe(true);
    }
  });

  test('package.json is valid JSON with a slugged name and bunmaska dep', () => {
    const pkg = JSON.parse(byPath.get('package.json') ?? '{}');
    expect(pkg.name).toBe('my-app');
    expect(pkg.dependencies.bunmaska).toMatch(/^\^/);
    expect(pkg.scripts.dev).toBe('bunmaska dev');
  });

  test('config substitutes the name and id', () => {
    const config = byPath.get('bunmaska.config.ts') ?? '';
    expect(config).toContain('name: "My App"');
    expect(config).toContain('id: "com.example.my-app"');
    expect(config).toContain("from 'bunmaska/config'");
  });

  test('gitignore covers the dev window-state scratch file', () => {
    expect(byPath.get('.gitignore') ?? '').toContain('.bunmaska-dev-state.json');
  });

  test('main.ts wires the preload and ipc handler', () => {
    const main = byPath.get('src/main.ts') ?? '';
    expect(main).toContain("ipcMain.handle('ping'");
    expect(main).toContain('preload:');
    expect(main).toContain("from 'bunmaska'");
  });
});

describe('scaffoldProject', () => {
  test('writes every template file and returns the paths', () => {
    const { deps, files } = memoryDeps();
    const template: ScaffoldFile[] = [
      { path: 'a.txt', contents: 'A' },
      { path: 'nested/b.txt', contents: 'B' },
    ];
    const written = scaffoldProject('/proj', template, deps);
    const root = resolve('/proj');
    expect(written.map(slash)).toEqual([
      slash(join(root, 'a.txt')),
      slash(join(root, 'nested/b.txt')),
    ]);
    expect(files.get(join(root, 'a.txt'))).toBe('A');
  });

  test('refuses to overwrite an existing file and writes nothing', () => {
    const { deps, files } = memoryDeps();
    const root = resolve('/proj');
    files.set(join(root, 'a.txt'), 'old');
    expect(() =>
      scaffoldProject(
        '/proj',
        [
          { path: 'a.txt', contents: 'new' },
          { path: 'b.txt', contents: 'B' },
        ],
        deps,
      ),
    ).toThrow(/refusing to overwrite/);
    // The non-conflicting file must NOT have been written (all-or-nothing).
    expect(files.has(join(root, 'b.txt'))).toBe(false);
    expect(files.get(join(root, 'a.txt'))).toBe('old');
  });
});

describe('runInit with an explicit name', () => {
  test('uses the given name instead of the directory name', () => {
    const written: string[] = [];
    const deps = {
      exists: () => false,
      mkdir: () => undefined,
      writeFile: (path: string, contents: string) => {
        written.push(path);
        if (path.endsWith('package.json')) {
          expect(JSON.parse(contents).name).toBe('my-app');
        }
      },
    };
    const result = runInit('/tmp/some-dir', deps, 'my-app');
    expect(result.name).toBe('my-app');
    expect(written.length).toBeGreaterThan(0);
  });
});

describe('index.html', () => {
  test('escapes the app name as HTML text', () => {
    const files = initTemplateFiles({ name: 'R&D <Tools>', id: 'com.example.rd' });
    const html = files.find((f) => f.path === 'src/index.html')?.contents ?? '';
    expect(html).toContain('<title>R&amp;D &lt;Tools&gt;</title>');
    expect(html).toContain('<h1>R&amp;D &lt;Tools&gt;</h1>');
  });
});

describe('deriveProjectName', () => {
  test('uses the directory base name', () => {
    expect(deriveProjectName('/tmp/cool-app')).toBe('cool-app');
  });

  test('falls back to bunmaska-app at the filesystem root', () => {
    expect(deriveProjectName('/')).toBe('bunmaska-app');
  });
});

/** A stand-in `bunmaska` package that records what the scaffolded main.ts does. */
const FAKE_BUNMASKA = `import { EventEmitter } from 'node:events';
export const calls = { windows: [], quits: 0, handlers: new Map() };
class App extends EventEmitter {
  whenReady() { return Promise.resolve(); }
  quit() { calls.quits += 1; }
}
export const app = new App();
export class BrowserWindow {
  constructor(options) { calls.windows.push(options); }
  loadFile() {}
}
export const ipcMain = { handle: (channel, fn) => calls.handlers.set(channel, fn) };
`;

type FakeBunmaska = {
  readonly calls: {
    readonly windows: { webPreferences: { preload: string } }[];
    readonly handlers: Map<string, () => unknown>;
  };
  readonly app: { emit(event: string, ...args: unknown[]): boolean };
};

describe('scaffolded main.ts', () => {
  const launch = async (): Promise<FakeBunmaska> => {
    const dir = join(makeTmpDir(), 'demo-app');
    runInit(dir);
    const fake = join(dir, 'node_modules', 'bunmaska');
    mkdirSync(fake, { recursive: true });
    writeFileSync(
      join(fake, 'package.json'),
      '{"name":"bunmaska","type":"module","main":"index.js"}',
    );
    writeFileSync(join(fake, 'index.js'), FAKE_BUNMASKA);
    const bunmaska = (await import(join(fake, 'index.js'))) as FakeBunmaska;
    await import(join(dir, 'src', 'main.ts'));
    await Promise.resolve();
    return bunmaska;
  };

  test('opens a window with an existing preload once ready and answers ping', async () => {
    const { calls } = await launch();
    expect(calls.windows).toHaveLength(1);
    expect(existsSync(calls.windows[0]?.webPreferences.preload ?? '')).toBe(true);
    expect(calls.handlers.get('ping')?.()).toBe('pong');
  });

  test('reopens a window on activate when none is visible (macOS Dock click)', async () => {
    const { app, calls } = await launch();
    app.emit('activate', {}, true);
    expect(calls.windows).toHaveLength(1);
    app.emit('activate', {}, false);
    expect(calls.windows).toHaveLength(2);
  });
});

describe('runInit (real filesystem)', () => {
  test('scaffolds a runnable project layout on disk', () => {
    const dir = join(makeTmpDir(), 'demo-app');
    const result = runInit(dir);
    expect(result.name).toBe('demo-app');
    expect(existsSync(join(dir, 'src/main.ts'))).toBe(true);
    expect(existsSync(join(dir, 'package.json'))).toBe(true);
    const html = readFileSync(join(dir, 'src/index.html'), 'utf8');
    expect(html).toContain('demo-app');
  });

  test('refuses to scaffold over an existing project', () => {
    const dir = join(makeTmpDir(), 'demo-app');
    runInit(dir);
    expect(() => runInit(dir)).toThrow(/refusing to overwrite/);
  });
});
