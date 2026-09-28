import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildWindowsAppOptions } from '../../../src/cli/build-windows';
import { INSTALLATION_COMPLETE } from '../../../src/common/engine-store';
import { dispatch } from '../../../src/cli/index';
import { captureStdio } from '../../helpers/capture-stdio';

const ID = 'webkit-2-2.52.4-bunmaska1-windows-x64';
const originalCwd = process.cwd();
const originalStore = process.env['BUNMASKA_ENGINES_PATH'];
let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bunmaska-dispatch-windows-'));
  writeFileSync(
    join(dir, 'bunmaska.config.ts'),
    `export default { entry: 'app.ts', engine: { webkit: '${ID}', embed: true } };\n`,
  );
  process.env['BUNMASKA_ENGINES_PATH'] = join(dir, 'store');
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalStore === undefined) {
    delete process.env['BUNMASKA_ENGINES_PATH'];
  } else {
    process.env['BUNMASKA_ENGINES_PATH'] = originalStore;
  }
  rmSync(dir, { recursive: true, force: true });
});

const buildWindows = async (): Promise<{
  code: number;
  captured: BuildWindowsAppOptions | undefined;
}> => {
  let captured: BuildWindowsAppOptions | undefined;
  const code = await dispatch(
    { kind: 'build', options: { target: 'windows', name: 'Demo' } },
    {
      buildWindows: async (opts) => {
        captured = opts;
        return { appDir: '', exePath: '', zip: '' };
      },
    },
  );
  return { code, captured };
};

describe('dispatch --target windows with another platform pinned', () => {
  test('bakes system and warns instead of a Linux engine id', async () => {
    writeFileSync(
      join(dir, 'bunmaska.config.ts'),
      "export default { entry: 'app.ts', engine: { webkit: 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64' } };\n",
    );
    let code = -1;
    let captured: BuildWindowsAppOptions | undefined;
    const streams = await captureStdio(async () => {
      ({ code, captured } = await buildWindows());
    });
    expect(code).toBe(0);
    expect(captured?.engineId).toBe('system');
    expect(streams.err.join('')).toContain('windows-x64');
  });
});

describe('dispatch --target windows with engine.embed', () => {
  test('bundles the installed pinned engine', async () => {
    mkdirSync(join(dir, 'store', ID), { recursive: true });
    writeFileSync(join(dir, 'store', ID, INSTALLATION_COMPLETE), '');
    const { code, captured } = await buildWindows();
    expect(code).toBe(0);
    expect(captured?.engineId).toBe(ID);
    expect(captured?.embedEngine).toBe(join(dir, 'store', ID, 'lib'));
  });

  test('refuses to build when the pinned engine is not installed', async () => {
    const { code, captured } = await buildWindows();
    expect(code).toBe(1);
    expect(captured).toBeUndefined();
  });
});
