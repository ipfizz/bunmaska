import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  bakedIdCandidates,
  type EngineResolution,
  engineLibPath,
  prepareEngineForLoad,
  type ResolveDeps,
  resetEnginePreparation,
  resolveEngineWith,
} from '../../../src/main/engine/resolve';

const ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';
const ROOT = '/store/webkit';

/** Host paths use the OS separator; normalize to '/' so assertions are host-agnostic. */
const slash = (s: string): string => s.replaceAll('\\', '/');

const resolve = (deps: ResolveDeps) =>
  resolveEngineWith({
    enginesRoot: ROOT,
    exists: () => true,
    readBakedId: () => null,
    host: { os: 'linux', arch: 'x64' },
    ...deps,
  });

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
    expect(slash(r.libDir ?? '')).toBe(`${ROOT}/${ID}/lib`);
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
    expect(slash(r.libDir ?? '')).toBe(`${ROOT}/${other}/lib`);
  });

  test('an empty BUNMASKA_WEBKIT_ID leaves the baked id in charge', () => {
    const r = resolve({ env: { BUNMASKA_WEBKIT_ID: ' ' }, readBakedId: () => ID });
    expect(r.id).toBe(ID);
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

  test('an installed engine built for another os -> system, with no install advice', () => {
    const windows = 'webkit-2-2.52.4-bunmaska1-windows-x64';
    const r = resolve({ env: { BUNMASKA_WEBKIT_ID: windows } });
    expect(r.mode).toBe('system');
    expect(r.warnings.join(' ')).toContain('windows-x64');
    expect(r.warnings.join(' ')).not.toContain('engine install');
  });

  test('an installed engine built for another arch -> system', () => {
    const arm = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-arm64';
    const r = resolve({ env: { BUNMASKA_WEBKIT_ID: arm } });
    expect(r.mode).toBe('system');
    expect(r.warnings.join(' ')).toContain('linux-arm64');
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
    expect(slash(c[0] ?? '')).toBe('/opt/app/usr/share/my-app/engine.id');
    expect(slash(c[1] ?? '')).toBe('/opt/app/usr/bin/engine.id');
  });

  test('outside a usr/bin layout, reads only the sibling engine.id', () => {
    const c = bakedIdCandidates('/home/u/Downloads/MyApp/MyApp', {});
    expect(c.map(slash)).toEqual(['/home/u/Downloads/MyApp/engine.id']);
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
    expect(slash(engineLibPath(r, 'libwebkitgtk-6.0.so.4'))).toBe(
      `${ROOT}/${ID}/lib/libwebkitgtk-6.0.so.4`,
    );
    expect(slash(engineLibPath(r, 'libgtk-4.so.1'))).toBe(`${ROOT}/${ID}/lib/libgtk-4.so.1`);
  });

  test('system -> the bare soname (ld.so default search)', () => {
    const r = resolve({ env: {} });
    expect(engineLibPath(r, 'libwebkitgtk-6.0.so.4')).toBe('libwebkitgtk-6.0.so.4');
  });
});

describe('prepareEngineForLoad', () => {
  // Reset BEFORE each test too: on Linux the real GTK/WebKitGTK loaders run in
  // the same process and set this one-shot guard, which would otherwise leak in.
  beforeEach(() => resetEnginePreparation());
  afterEach(() => resetEnginePreparation());

  test('pinned: prints warnings exactly once', () => {
    const pinned: EngineResolution = {
      mode: 'pinned',
      libDir: '/store/x/lib',
      warnings: ['heads up'],
    };
    const writes: string[] = [];
    prepareEngineForLoad(pinned, {}, (s) => writes.push(s));
    expect(writes).toEqual(['heads up\n']);

    // A second call (e.g. the other loader) is a no-op — single shared engine.
    prepareEngineForLoad(pinned, { LD_LIBRARY_PATH: '/other' }, (s) => writes.push(s));
    expect(writes).toEqual(['heads up\n']);
  });

  test('pinned: leaves the env alone, so child_process children never inherit the engine libs', () => {
    const target: Record<string, string | undefined> = { LD_LIBRARY_PATH: '/usr/lib' };
    prepareEngineForLoad(
      { mode: 'pinned', libDir: '/store/x/lib', warnings: [] },
      target,
      () => undefined,
    );
    expect(target).toEqual({ LD_LIBRARY_PATH: '/usr/lib' });
  });

  test('system: prints nothing', () => {
    const writes: string[] = [];
    prepareEngineForLoad({ mode: 'system', warnings: [] }, {}, (s) => writes.push(s));
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
