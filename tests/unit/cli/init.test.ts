import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveProjectName,
  initTemplateFiles,
  runInit,
  type ScaffoldDeps,
  type ScaffoldFile,
  scaffoldProject,
} from '../../../src/cli/init';

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sambar-init-'));
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
      'sambar.config.ts',
      'src/main.ts',
      'src/preload.ts',
      'src/index.html',
      '.gitignore',
      'README.md',
    ]) {
      expect(byPath.has(path)).toBe(true);
    }
  });

  test('package.json is valid JSON with a slugged name and sambar dep', () => {
    const pkg = JSON.parse(byPath.get('package.json') ?? '{}');
    expect(pkg.name).toBe('my-app');
    expect(pkg.dependencies.sambar).toMatch(/^\^/);
    expect(pkg.scripts.dev).toBe('sambar dev');
  });

  test('config substitutes the name and id', () => {
    const config = byPath.get('sambar.config.ts') ?? '';
    expect(config).toContain('name: "My App"');
    expect(config).toContain('id: "com.example.my-app"');
    expect(config).toContain("from 'sambar/config'");
  });

  test('main.ts wires the preload and ipc handler', () => {
    const main = byPath.get('src/main.ts') ?? '';
    expect(main).toContain("ipcMain.handle('ping'");
    expect(main).toContain('preload:');
    expect(main).toContain("from 'sambar'");
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
    expect(written).toEqual([join('/proj', 'a.txt'), join('/proj', 'nested/b.txt')]);
    expect(files.get(join('/proj', 'a.txt'))).toBe('A');
  });

  test('refuses to overwrite an existing file and writes nothing', () => {
    const { deps, files } = memoryDeps();
    files.set(join('/proj', 'a.txt'), 'old');
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
    expect(files.has(join('/proj', 'b.txt'))).toBe(false);
    expect(files.get(join('/proj', 'a.txt'))).toBe('old');
  });
});

describe('deriveProjectName', () => {
  test('uses the directory base name', () => {
    expect(deriveProjectName('/tmp/cool-app')).toBe('cool-app');
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
