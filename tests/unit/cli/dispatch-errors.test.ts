import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '../../../src/cli/index';
import type { Command } from '../../../src/cli/parse-args';
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
      code = await dispatch(command);
    });
    expect(code).toBe(1);
    expect(streams.err.join('')).toMatch(/^[^\n]*"name" must be a string[^\n]*\n$/);
  });
});
