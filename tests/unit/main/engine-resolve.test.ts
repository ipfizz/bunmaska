import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  bakedIdCandidates,
  type EngineResolution,
  engineEnv,
  engineLibPath,
  prepareEngineForLoad,
  type ResolveDeps,
  resetEnginePreparation,
  resolveEngineWith,
} from '../../../src/main/engine/resolve';

const ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';
const ROOT = '/store/webkit';

const resolve = (deps: ResolveDeps) =>
  resolveEngineWith({ enginesRoot: ROOT, exists: () => true, readBakedId: () => null, ...deps });

describe('resolveEngineWith', () => {
  test('BUNMASKA_WEBKIT_PATH wins — explicit pinned dir, highest precedence', () => {
    const r = resolve({ env: { BUNMASKA_WEBKIT_PATH: '/opt/webkit/lib' } });
    expect(r.mode).toBe('pinned');
    expect(r.libDir).toBe('/opt/webkit/lib');
    expect(r.warnings).toEqual([]);
  });

  test('no id anywhere -> system (the default, no warning)', () => {
    const r = resolve({ env: {}, readBakedId: () => null });
    expect(r.mode).toBe('system');
    expect(r.warnings).toEqual([]);
  });

  test("the 'system' sentinel -> system", () => {
    const r = resolve({ env: { BUNMASKA_WEBKIT_ID: 'system' } });
    expect(r.mode).toBe('system');
  });

  test('baked id with a present marker -> pinned at <root>/<id>/lib', () => {
    const r = resolve({ env: {}, readBakedId: () => ID, exists: () => true });
    expect(r.mode).toBe('pinned');
    expect(r.libDir).toBe(`${ROOT}/${ID}/lib`);
    expect(r.warnings).toEqual([]);
  });

  test('baked id but missing marker -> system fallback, loud warning names the id', () => {
    const r = resolve({ env: {}, readBakedId: () => ID, exists: () => false });
    expect(r.mode).toBe('system');
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain(ID);
    expect(r.warnings[0]).toMatch(/tested|system|install/i);
  });

  test('BUNMASKA_WEBKIT_ID overrides the baked id', () => {
    const other = 'webkitgtk-6.0-2.46.0-bunmaska1-linux-x64';
    const r = resolve({ env: { BUNMASKA_WEBKIT_ID: other }, readBakedId: () => ID });
    expect(r.libDir).toBe(`${ROOT}/${other}/lib`);
  });

  test('a malformed id -> system fallback with a warning', () => {
    const r = resolve({ env: { BUNMASKA_WEBKIT_ID: 'not-an-engine-id' } });
    expect(r.mode).toBe('system');
    expect(r.warnings.length).toBe(1);
  });

  test('store-resolved pinned carries the engine id + root (for refcount linking)', () => {
    const r = resolve({ env: {}, readBakedId: () => ID });
    expect(r.id).toBe(ID);
    expect(r.root).toBe(ROOT);
  });

  test('explicit BUNMASKA_WEBKIT_PATH pin carries no id/root (nothing to refcount)', () => {
    const r = resolve({ env: { BUNMASKA_WEBKIT_PATH: '/opt/webkit/lib' } });
    expect(r.id).toBeUndefined();
    expect(r.root).toBeUndefined();
  });
});

describe('bakedIdCandidates', () => {
  test('prefers the install layout usr/share/<slug>/engine.id', () => {
    const c = bakedIdCandidates('/opt/app/usr/bin/my-app', {});
    expect(c[0]).toBe('/opt/app/usr/share/my-app/engine.id');
    expect(c[1]).toBe('/opt/app/usr/bin/engine.id');
  });

  test('an explicit BUNMASKA_ENGINE_ID_FILE wins outright', () => {
    expect(
      bakedIdCandidates('/opt/app/usr/bin/my-app', { BUNMASKA_ENGINE_ID_FILE: '/x/id' }),
    ).toEqual(['/x/id']);
  });
});

describe('engineLibPath', () => {
  test('pinned -> absolute path into the engine lib dir', () => {
    const r = resolve({ env: {}, readBakedId: () => ID });
    expect(engineLibPath(r, 'libwebkitgtk-6.0.so.4')).toBe(
      `${ROOT}/${ID}/lib/libwebkitgtk-6.0.so.4`,
    );
    expect(engineLibPath(r, 'libgtk-4.so.1')).toBe(`${ROOT}/${ID}/lib/libgtk-4.so.1`);
  });

  test('system -> the bare soname (ld.so default search)', () => {
    const r = resolve({ env: {} });
    expect(engineLibPath(r, 'libwebkitgtk-6.0.so.4')).toBe('libwebkitgtk-6.0.so.4');
  });
});

describe('engineEnv', () => {
  test('pinned -> prepends the lib dir to LD_LIBRARY_PATH and sets GIO_EXTRA_MODULES', () => {
    const r = resolve({ env: {}, readBakedId: () => ID });
    const env = engineEnv(r, { LD_LIBRARY_PATH: '/usr/lib' });
    expect(env.LD_LIBRARY_PATH).toBe(`${ROOT}/${ID}/lib:/usr/lib`);
    expect(env.GIO_EXTRA_MODULES).toBe(`${ROOT}/${ID}/lib/gio/modules`);
  });

  test('pinned with no prior LD_LIBRARY_PATH -> just the lib dir', () => {
    const r = resolve({ env: {}, readBakedId: () => ID });
    const env = engineEnv(r, {});
    expect(env.LD_LIBRARY_PATH).toBe(`${ROOT}/${ID}/lib`);
  });

  test('system -> no env changes', () => {
    const r = resolve({ env: {} });
    expect(engineEnv(r, { LD_LIBRARY_PATH: '/usr/lib' })).toEqual({});
  });
});

describe('prepareEngineForLoad', () => {
  // Reset BEFORE each test too: on Linux the real GTK/WebKitGTK loaders run in
  // the same process and set this one-shot guard, which would otherwise leak in.
  beforeEach(() => resetEnginePreparation());
  afterEach(() => resetEnginePreparation());

  test('pinned: exports the engine env and prints warnings, exactly once', () => {
    const pinned: EngineResolution = {
      mode: 'pinned',
      libDir: '/store/x/lib',
      warnings: ['heads up'],
    };
    const target: Record<string, string | undefined> = { LD_LIBRARY_PATH: '/usr/lib' };
    const writes: string[] = [];
    prepareEngineForLoad(pinned, target, (s) => writes.push(s));
    expect(target['LD_LIBRARY_PATH']).toBe('/store/x/lib:/usr/lib');
    expect(target['GIO_EXTRA_MODULES']).toBe('/store/x/lib/gio/modules');
    expect(writes).toEqual(['heads up\n']);

    // A second call (e.g. the other loader) is a no-op — single shared engine.
    prepareEngineForLoad(pinned, { LD_LIBRARY_PATH: '/other' }, (s) => writes.push(s));
    expect(writes).toEqual(['heads up\n']);
  });

  test('system: applies no env and prints nothing', () => {
    const target: Record<string, string | undefined> = { LD_LIBRARY_PATH: '/usr/lib' };
    const writes: string[] = [];
    prepareEngineForLoad({ mode: 'system', warnings: [] }, target, (s) => writes.push(s));
    expect(target['LD_LIBRARY_PATH']).toBe('/usr/lib');
    expect(target['GIO_EXTRA_MODULES']).toBeUndefined();
    expect(writes).toEqual([]);
  });

  test('store-pinned: registers an app→engine link exactly once (refcount)', () => {
    const pinned: EngineResolution = {
      mode: 'pinned',
      libDir: `${ROOT}/${ID}/lib`,
      id: ID,
      root: ROOT,
      warnings: [],
    };
    const links: Array<[string, string, string]> = [];
    const deps = {
      appPath: '/opt/MyApp',
      link: (root: string, app: string, id: string) => {
        links.push([root, app, id]);
      },
    };
    prepareEngineForLoad(pinned, {}, () => undefined, deps);
    prepareEngineForLoad(pinned, {}, () => undefined, deps); // second loader call = no-op
    expect(links).toEqual([[ROOT, '/opt/MyApp', ID]]);
  });

  test('explicit-dir pin (no id/root) does not link — nothing to refcount', () => {
    const links: unknown[] = [];
    prepareEngineForLoad(
      { mode: 'pinned', libDir: '/opt/lib', warnings: [] },
      {},
      () => undefined,
      {
        appPath: '/a',
        link: (...a) => {
          links.push(a);
        },
      },
    );
    expect(links).toEqual([]);
  });

  test('system mode does not link', () => {
    const links: unknown[] = [];
    prepareEngineForLoad({ mode: 'system', warnings: [] }, {}, () => undefined, {
      appPath: '/a',
      link: (...a) => {
        links.push(a);
      },
    });
    expect(links).toEqual([]);
  });
});
