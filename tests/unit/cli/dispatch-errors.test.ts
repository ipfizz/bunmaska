import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '../../../src/cli/index';
import type { BuildOptions, Command } from '../../../src/cli/parse-args';
import { captureStdio } from '../../helpers/capture-stdio';

const originalCwd = process.cwd();
let dir: string | undefined;
afterEach(() => {
  process.chdir(originalCwd);
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const inProjectWithConfig = (config: string): void => {
  dir = mkdtempSync(join(tmpdir(), 'bunmaska-dispatch-errors-'));
  writeFileSync(join(dir, 'bunmaska.config.ts'), config);
  process.chdir(dir);
};

describe('dispatch error boundary', () => {
  test.each<Command>([
    { kind: 'build', entry: 'app.ts', options: {} },
    { kind: 'doctor' },
    { kind: 'run', entry: 'app.ts', args: [] },
  ])('$kind reports an invalid config as one stderr line and exits 1', async (command) => {
    inProjectWithConfig('export default { name: 42 };\n');
    let code = -1;
    const streams = await captureStdio(async () => {
      code = await dispatch(command, { runApp: async () => 0 });
    });
    expect(code).toBe(1);
    expect(streams.err.join('')).toMatch(/^[^\n]*"name" must be a string[^\n]*\n$/);
  });
});

describe('dispatch refuses build options that do not apply, before building', () => {
  const recordingBuilders = (built: string[]) => ({
    buildMac: async () => {
      built.push('macos');
      return '';
    },
    buildLinux: async () => {
      built.push('linux');
      return { appDir: '', tarball: '', deb: '' };
    },
    buildWindows: async () => {
      built.push('windows');
      return { appDir: '', exePath: '', zip: '' };
    },
  });

  test.each<[string, BuildOptions, string]>([
    ['--sign off macOS', { target: 'linux', sign: '-' }, '--sign is macOS-only'],
    ['--notarize off macOS', { target: 'windows', notarize: true }, '--notarize is macOS-only'],
    ['--dmg off macOS', { target: 'linux', dmg: true }, '--dmg is macOS-only'],
    ['--embed-engine off Windows', { target: 'linux', embedEngine: 'x' }, 'Windows-only'],
    ['engine.embed on Linux', { target: 'linux' }, 'not supported on Linux'],
  ])('%s', async (_label, options, message) => {
    inProjectWithConfig('export default { engine: { embed: true } };\n');
    const built: string[] = [];
    let code = -1;
    const streams = await captureStdio(async () => {
      code = await dispatch({ kind: 'build', entry: 'app.ts', options }, recordingBuilders(built));
    });
    expect(code).toBe(1);
    expect(built).toEqual([]);
    expect(streams.err.join('')).toContain(message);
  });
});

describe('dispatch init', () => {
  test('scaffolds once, then refuses to overwrite the project', async () => {
    inProjectWithConfig('export default {};\n');
    const target = join(dir ?? '', 'demo-app');
    let codes: number[] = [];
    const streams = await captureStdio(async () => {
      codes = [
        await dispatch({ kind: 'init', dir: target }),
        await dispatch({ kind: 'init', dir: target }),
      ];
    });
    expect(codes).toEqual([0, 1]);
    expect(streams.out.join('')).toContain('Scaffolded demo-app');
    expect(streams.err.join('')).toContain('refusing to overwrite');
  });
});
