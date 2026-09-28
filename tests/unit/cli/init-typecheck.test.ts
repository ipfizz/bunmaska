import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInit } from '../../../src/cli/init';

const REPO = resolve(import.meta.dir, '../../..');

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) {
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
});

test('a fresh scaffold type-checks against bunmaska and its declared types', () => {
  root = mkdtempSync(join(tmpdir(), 'bunmaska-init-tsc-'));
  const dir = join(root, 'demo-app');
  runInit(dir);
  // Stand in for `bun install`: link each declared dependency from this checkout.
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const link = join(dir, 'node_modules', name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(name === 'bunmaska' ? REPO : join(REPO, 'node_modules', name), link, 'junction');
  }

  const tsc = Bun.spawnSync([
    process.execPath,
    join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '-p',
    dir,
  ]);

  expect(tsc.stdout.toString()).toBe('');
  expect(tsc.exitCode).toBe(0);
}, 60_000);
