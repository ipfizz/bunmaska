import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentHash } from '../../../src/common/manifest';
import {
  enginesPath,
  engineDir,
  gc,
  installFromSource,
  type InstallSource,
  isInstalled,
  linkApp,
  linkPath,
  listInstalled,
  markerPath,
  readLinks,
  unlinkApp,
  withLock,
} from '../../../src/cli/engine-store';

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

/** Extract that writes a deterministic engine tree from the tarball bytes. */
const fakeExtract = async (bytes: Uint8Array, destDir: string): Promise<void> => {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(destDir, 'lib'), { recursive: true });
  writeFileSync(join(destDir, 'lib', 'libwebkitgtk-6.0.so.4'), bytes);
  writeFileSync(join(destDir, 'engine.json'), JSON.stringify({ soname: 'libwebkitgtk-6.0.so.4' }));
};

describe('enginesPath (env-driven default root)', () => {
  test('honors BUNMASKA_ENGINES_PATH first', () => {
    expect(enginesPath({ BUNMASKA_ENGINES_PATH: '/custom/engines' })).toBe('/custom/engines');
  });

  test('falls back to <BUNMASKA_HOME>/webkit', () => {
    expect(enginesPath({ BUNMASKA_HOME: '/srv/bm' })).toBe('/srv/bm/webkit');
  });

  test('defaults under the home dir when unset', () => {
    const path = enginesPath({ HOME: '/home/alice' });
    expect(path.endsWith('/.bunmaska/webkit')).toBe(true);
  });
});

describe('path helpers', () => {
  test('engineDir / markerPath compose under the root', () => {
    expect(engineDir('/r', ID)).toBe(`/r/${ID}`);
    expect(markerPath('/r', ID)).toBe(`/r/${ID}/INSTALLATION_COMPLETE`);
  });

  test('linkPath is a stable hash under .links', () => {
    expect(linkPath('/r', '/opt/App')).toBe(linkPath('/r', '/opt/App'));
    expect(linkPath('/r', '/opt/App')).not.toBe(linkPath('/r', '/opt/Other'));
    expect(linkPath('/r', '/opt/App').startsWith('/r/.links/')).toBe(true);
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
