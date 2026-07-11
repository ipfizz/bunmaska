import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentHash } from '../../../src/common/manifest';
import {
  assertSafeEngineId,
  enginesPath,
  engineDir,
  gc,
  installFromDir,
  installFromSource,
  type InstallSource,
  isInstalled,
  linkApp,
  linkPath,
  listInstalled,
  markerPath,
  readLinks,
  unlinkApp,
  verifyEngine,
  withLock,
} from '../../../src/cli/engine-store';

/** Host paths use the OS separator; normalize to '/' so assertions are host-agnostic. */
const slash = (s: string): string => s.replaceAll('\\', '/');

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-store-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';
const ID2 = 'webkitgtk-6.0-2.46.0-bunmaska1-linux-x64';

/** A fake engine tarball payload + its honest manifest hash. */
const fakeSource = (id: string, body = 'ENGINE-BYTES'): InstallSource => {
  const bytes = new TextEncoder().encode(`${id}:${body}`);
  return { id, bytes, expectedHash: contentHash(bytes) };
};

/** Extract a deterministic engine tree; the engine.json id is decoded from the
 *  bytes (fakeSource embeds it), so a genuine artifact's signed id is preserved. */
const fakeExtract = async (bytes: Uint8Array, destDir: string): Promise<void> => {
  const id = new TextDecoder().decode(bytes).split(':')[0] ?? '';
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(destDir, 'lib'), { recursive: true });
  writeFileSync(join(destDir, 'lib', 'libwebkitgtk-6.0.so.4'), bytes);
  writeFileSync(join(destDir, 'engine.json'), JSON.stringify({ id, soname: 'libwebkitgtk-6.0.so.4' }));
};

describe('enginesPath (env-driven default root)', () => {
  test('honors BUNMASKA_ENGINES_PATH first', () => {
    expect(enginesPath({ BUNMASKA_ENGINES_PATH: '/custom/engines' })).toBe('/custom/engines');
  });

  test('falls back to <BUNMASKA_HOME>/webkit', () => {
    expect(slash(enginesPath({ BUNMASKA_HOME: '/srv/bm' }))).toBe('/srv/bm/webkit');
  });

  test('defaults under the home dir when unset', () => {
    const path = enginesPath({ HOME: '/home/alice' });
    expect(slash(path).endsWith('/.bunmaska/webkit')).toBe(true);
  });
});

describe('path helpers', () => {
  test('engineDir / markerPath compose under the root', () => {
    expect(slash(engineDir('/r', ID))).toBe(`/r/${ID}`);
    expect(slash(markerPath('/r', ID))).toBe(`/r/${ID}/INSTALLATION_COMPLETE`);
  });

  test('linkPath is a stable hash under .links', () => {
    expect(linkPath('/r', '/opt/App')).toBe(linkPath('/r', '/opt/App'));
    expect(linkPath('/r', '/opt/App')).not.toBe(linkPath('/r', '/opt/Other'));
    expect(slash(linkPath('/r', '/opt/App')).startsWith('/r/.links/')).toBe(true);
  });
});

describe('installFromSource', () => {
  test('extracts, then writes the INSTALLATION_COMPLETE marker LAST', async () => {
    const root = makeTmpDir();
    const order: string[] = [];
    await installFromSource(root, fakeSource(ID), {
      extract: async (bytes, dest) => {
        order.push('extract');
        await fakeExtract(bytes, dest);
      },
      onMarker: () => order.push('marker'),
    });
    expect(order).toEqual(['extract', 'marker']);
    expect(isInstalled(root, ID)).toBe(true);
    expect(existsSync(join(engineDir(root, ID), 'lib', 'libwebkitgtk-6.0.so.4'))).toBe(true);
  });

  test('rejects a hash mismatch and leaves NO engine dir behind', async () => {
    const root = makeTmpDir();
    const bad: InstallSource = { ...fakeSource(ID), expectedHash: 'deadbeefdeadbeef' };
    await expect(installFromSource(root, bad, { extract: fakeExtract })).rejects.toThrow(
      /integrity|hash/i,
    );
    expect(existsSync(engineDir(root, ID))).toBe(false);
  });

  test('is idempotent — a second install does not re-extract', async () => {
    const root = makeTmpDir();
    let extracts = 0;
    const deps = {
      extract: async (b: Uint8Array, d: string) => {
        extracts += 1;
        await fakeExtract(b, d);
      },
    };
    const first = await installFromSource(root, fakeSource(ID), deps);
    const second = await installFromSource(root, fakeSource(ID), deps);
    expect(first.installed).toBe(true);
    expect(second.installed).toBe(false);
    expect(extracts).toBe(1);
  });

  test('rejects an unsafe (path-traversal) id before touching the filesystem', async () => {
    const root = makeTmpDir();
    let extracted = false;
    const deps = {
      extract: async (b: Uint8Array, d: string) => {
        extracted = true;
        await fakeExtract(b, d);
      },
    };
    for (const id of ['../escape', '../../etc', 'a/b', '..', '.', '']) {
      await expect(installFromSource(root, fakeSource(id), deps)).rejects.toThrow(
        /unsafe engine id/,
      );
    }
    expect(extracted).toBe(false);
  });

  test('rejects store-reserved ids (.links, __dirlock) before touching the filesystem', async () => {
    const root = makeTmpDir();
    let extracted = false;
    const deps = {
      extract: async (b: Uint8Array, d: string) => {
        extracted = true;
        await fakeExtract(b, d);
      },
    };
    for (const id of ['.links', '__dirlock', '.tmp-x', 'INSTALLATION_COMPLETE']) {
      await expect(installFromSource(root, fakeSource(id), deps)).rejects.toThrow(
        /unsafe engine id/,
      );
    }
    expect(extracted).toBe(false);
  });

  test('rejects a substituted engine — extracted engine.json id must match the claimed id', async () => {
    const root = makeTmpDir();
    // A genuinely-signed OLDER artifact (its engine.json says ID2) served under ID's URL.
    const substituted: InstallSource = { ...fakeSource(ID2), id: ID, expectedHash: fakeSource(ID2).expectedHash };
    await expect(installFromSource(root, substituted, { extract: fakeExtract })).rejects.toThrow(
      /different id/i,
    );
    // Neither the claimed nor the real dir is left behind, and the marker is not written.
    expect(isInstalled(root, ID)).toBe(false);
    expect(existsSync(engineDir(root, ID))).toBe(false);
  });

  test('two concurrent installs of the same id: exactly one wins, store stays intact', async () => {
    const root = makeTmpDir();
    const deps = { extract: fakeExtract };
    const [a, b] = await Promise.all([
      installFromSource(root, fakeSource(ID), deps),
      installFromSource(root, fakeSource(ID), deps),
    ]);
    expect([a.installed, b.installed].filter(Boolean)).toHaveLength(1);
    expect(isInstalled(root, ID)).toBe(true);
    expect(verifyEngine(root, ID).ok).toBe(true);
    // No orphaned staging dirs left behind.
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(root).some((n) => n.startsWith('.tmp-'))).toBe(false);
  });
});

describe('assertSafeEngineId', () => {
  const root = '/store/webkit';

  test('accepts a well-formed engine id', () => {
    expect(() => assertSafeEngineId(root, ID)).not.toThrow();
  });

  test('rejects separators, absolute paths, dot segments, and empties', () => {
    for (const id of ['../x', '..', '.', '', 'a/b', 'a\\b', '/abs/path', 'x/../../y']) {
      expect(() => assertSafeEngineId(root, id)).toThrow(/unsafe engine id/);
    }
  });
});

describe('listInstalled', () => {
  test('returns only marker-complete engine dirs', async () => {
    const root = makeTmpDir();
    await installFromSource(root, fakeSource(ID), { extract: fakeExtract });
    // A half-installed dir without the marker must be ignored.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(engineDir(root, ID2), { recursive: true });
    expect(listInstalled(root)).toEqual([ID]);
  });
});

describe('links (refcount source of truth)', () => {
  test('linkApp / readLinks / unlinkApp round-trip', () => {
    const root = makeTmpDir();
    linkApp(root, '/opt/MyApp', ID);
    linkApp(root, '/opt/OtherApp', ID2);
    const links = readLinks(root).sort((a, b) => a.app.localeCompare(b.app));
    expect(links).toEqual([
      { app: '/opt/MyApp', engine: ID },
      { app: '/opt/OtherApp', engine: ID2 },
    ]);
    unlinkApp(root, '/opt/MyApp');
    expect(readLinks(root)).toEqual([{ app: '/opt/OtherApp', engine: ID2 }]);
  });
});

describe('gc', () => {
  test('keeps referenced engines, removes the rest, honors dry-run', async () => {
    const root = makeTmpDir();
    await installFromSource(root, fakeSource(ID), { extract: fakeExtract });
    await installFromSource(root, fakeSource(ID2), { extract: fakeExtract });
    linkApp(root, '/opt/MyApp', ID); // only ID is referenced

    const dry = await gc(root, { exists: () => true, dryRun: true });
    expect(dry.removed).toEqual([ID2]);
    expect(isInstalled(root, ID2)).toBe(true); // dry-run deletes nothing

    const real = await gc(root, { exists: () => true });
    expect(real.kept).toEqual([ID]);
    expect(real.removed).toEqual([ID2]);
    expect(isInstalled(root, ID)).toBe(true);
    expect(isInstalled(root, ID2)).toBe(false);
  });

  test('drops links whose app no longer exists, freeing its engine', async () => {
    const root = makeTmpDir();
    await installFromSource(root, fakeSource(ID), { extract: fakeExtract });
    linkApp(root, '/opt/GoneApp', ID);
    const result = await gc(root, { exists: (p) => p !== '/opt/GoneApp' });
    expect(result.droppedLinks).toBe(1);
    expect(result.removed).toEqual([ID]);
    expect(readLinks(root)).toEqual([]);
  });
});

/** Build a valid, already-extracted engine source dir (lib/ + engine.json). */
const makeEngineDir = (parent: string, id: string, soname = 'libwebkitgtk-6.0.so.4'): string => {
  const { mkdirSync } = require('node:fs') as typeof import('node:fs');
  const dir = join(parent, `src-${id}`);
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', soname), 'SO');
  writeFileSync(join(dir, 'engine.json'), JSON.stringify({ id, soname }));
  return dir;
};

describe('installFromDir', () => {
  test('copies a local engine tree in and marks it complete; idempotent', async () => {
    const root = makeTmpDir();
    const src = makeEngineDir(root, ID);
    const first = await installFromDir(root, src);
    expect(first).toEqual({ id: ID, installed: true });
    expect(isInstalled(root, ID)).toBe(true);
    expect(existsSync(join(engineDir(root, ID), 'lib', 'libwebkitgtk-6.0.so.4'))).toBe(true);

    const second = await installFromDir(root, src);
    expect(second).toEqual({ id: ID, installed: false });
  });

  test('rejects a source dir with no readable engine.json', async () => {
    const root = makeTmpDir();
    const { mkdirSync } = await import('node:fs');
    const bogus = join(root, 'bogus');
    mkdirSync(bogus, { recursive: true });
    await expect(installFromDir(root, bogus)).rejects.toThrow(/engine\.json/i);
  });

  test('accepts an engine.json written with a UTF-8 BOM (Windows tooling)', async () => {
    const root = makeTmpDir();
    const src = makeEngineDir(root, ID);
    const manifest = JSON.stringify({ id: ID, soname: 'libwebkitgtk-6.0.so.4' });
    writeFileSync(join(src, 'engine.json'), `\uFEFF${manifest}`);
    const result = await installFromDir(root, src);
    expect(result).toEqual({ id: ID, installed: true });
  });
});

describe('verifyEngine', () => {
  test('ok for a well-formed installed engine', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    expect(verifyEngine(root, ID)).toEqual({ id: ID, ok: true, problems: [] });
  });

  test('reports a missing soname lib', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    rmSync(join(engineDir(root, ID), 'lib', 'libwebkitgtk-6.0.so.4'), { force: true });
    const result = verifyEngine(root, ID);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/missing lib/);
  });

  test('reports a not-installed engine', () => {
    const root = makeTmpDir();
    const result = verifyEngine(root, ID);
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

describe('withLock', () => {
  test('runs the body and releases the lock', async () => {
    const root = makeTmpDir();
    const value = await withLock(root, async () => 42);
    expect(value).toBe(42);
    expect(existsSync(join(root, '__dirlock'))).toBe(false);
  });

  test('releases the lock even when the body throws', async () => {
    const root = makeTmpDir();
    await expect(
      withLock(root, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(join(root, '__dirlock'))).toBe(false);
  });

  test('serializes concurrent critical sections', async () => {
    const root = makeTmpDir();
    const trace: string[] = [];
    const crit = (tag: string) =>
      withLock(root, async () => {
        trace.push(`${tag}:enter`);
        await Bun.sleep(5);
        trace.push(`${tag}:exit`);
      });
    await Promise.all([crit('a'), crit('b')]);
    // Whichever ran first must fully finish before the other enters.
    expect(trace).toContain('a:enter');
    expect(trace).toContain('b:enter');
    const firstExit = trace.indexOf(`${trace[0]?.split(':')[0]}:exit`);
    const otherEnter = trace.findIndex(
      (t) => t.endsWith(':enter') && !t.startsWith(trace[0]?.split(':')[0] ?? ''),
    );
    expect(firstExit).toBeLessThan(otherEnter);
  });
});
