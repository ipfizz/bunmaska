import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BunmaskaConfig } from '../../../src/common/config-schema';
import { runDoctor, runEngine } from '../../../src/cli/engine-command';
import { installFromDir, linkApp } from '../../../src/cli/engine-store';

const ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';
const ID2 = 'webkitgtk-6.0-2.46.0-bunmaska1-linux-x64';

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-cmd-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const makeEngineDir = (parent: string, id: string): string => {
  const dir = join(parent, `src-${id}`);
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'libwebkitgtk-6.0.so.4'), 'SO');
  writeFileSync(join(dir, 'engine.json'), JSON.stringify({ id, soname: 'libwebkitgtk-6.0.so.4' }));
  return dir;
};

type Captured = {
  readonly deps: Parameters<typeof runEngine>[1];
  readonly out: string[];
  readonly err: string[];
  text: () => string;
};
const capture = (root: string, config: BunmaskaConfig = {}): Captured => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    text: () => out.join('\n'),
    deps: {
      root,
      env: {},
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      readConfig: async () => config,
    },
  };
};

describe('engine available', () => {
  test('lists engines from the feed index and points at the install command', async () => {
    const c = capture(makeTmpDir());
    const deps = {
      ...c.deps,
      fetchIndex: async () => [
        {
          engine: 'webkitgtk',
          api: '6.0',
          upstream: '2.46.0',
          rev: 'bunmaska1',
          os: 'linux',
          arch: 'x64',
          id: ID2,
          size: 92160000,
        } as never,
      ],
    };
    expect(await runEngine({ action: 'available' }, deps)).toBe(0);
    expect(c.text()).toContain(ID2);
    expect(c.text()).toMatch(/bunmaska engine install/);
  });

  test('reports empty feed gracefully', async () => {
    const c = capture(makeTmpDir());
    const deps = { ...c.deps, fetchIndex: async () => [] };
    expect(await runEngine({ action: 'available' }, deps)).toBe(0);
    expect(c.text()).toMatch(/no engines/i);
  });

  test('errors (exit 1) when the feed index cannot be read', async () => {
    const c = capture(makeTmpDir());
    const deps = {
      ...c.deps,
      fetchIndex: async () => {
        throw new Error('network down');
      },
    };
    expect(await runEngine({ action: 'available' }, deps)).toBe(1);
    expect(c.err.join('\n')).toMatch(/could not read the feed index/i);
  });
});

describe('engine list', () => {
  test('reports the system default when empty', async () => {
    const c = capture(makeTmpDir());
    expect(await runEngine({ action: 'list' }, c.deps)).toBe(0);
    expect(c.text()).toMatch(/system WebKit/i);
  });

  test('lists installed engines with their refcount, sorted by version', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    await installFromDir(root, makeEngineDir(root, ID2));
    linkApp(root, '/opt/A', ID);
    linkApp(root, '/opt/B', ID);
    const c = capture(root);
    await runEngine({ action: 'list' }, c.deps);
    // ID2 (2.46) sorts before ID (2.52); ID has 2 apps.
    expect(c.out[0]).toContain(ID2);
    expect(c.out[1]).toContain(ID);
    expect(c.out[1]).toContain('(2 apps)');
  });
});

describe('engine which', () => {
  test('system when the project does not pin', async () => {
    const c = capture(makeTmpDir(), {});
    await runEngine({ action: 'which' }, c.deps);
    expect(c.text()).toMatch(/system/i);
  });

  test('flags a pinned-but-not-installed engine', async () => {
    const c = capture(makeTmpDir(), { engine: { webkit: ID } });
    await runEngine({ action: 'which' }, c.deps);
    expect(c.text()).toContain(ID);
    expect(c.text()).toMatch(/NOT installed/);
  });

  test('shows installed for a present engine', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    const c = capture(root, { engine: { webkit: ID } });
    await runEngine({ action: 'which' }, c.deps);
    expect(c.text()).toMatch(/\[installed\]/);
  });
});

describe('engine install', () => {
  test('installs from a local engine directory', async () => {
    const root = makeTmpDir();
    const src = makeEngineDir(root, ID);
    const c = capture(root);
    expect(await runEngine({ action: 'install', source: src }, c.deps)).toBe(0);
    expect(c.text()).toContain(`installed ${ID}`);
  });

  test('errors (exit 1) on a source that is neither a dir, an id, nor a URL', async () => {
    const c = capture(makeTmpDir());
    expect(await runEngine({ action: 'install', source: 'not-an-engine' }, c.deps)).toBe(1);
    expect(c.err.join('\n')).toMatch(/local engine directory|engine-id|feed URL/i);
  });

  test('remote URL install uses the self-hosted feed key from bunmaska.config', async () => {
    const c = capture(makeTmpDir(), { engine: { feed: { publicKey: 'CONFIG-KEY' } } });
    let seen: { root: string; url: string; key: string } | undefined;
    const deps = {
      ...c.deps,
      installUrl: async (root: string, url: string, key: string) => {
        seen = { root, url, key };
        return { id: ID, installed: true };
      },
    };
    expect(await runEngine({ action: 'install', source: 'https://feed/x.tar.zst' }, deps)).toBe(0);
    expect(seen?.url).toBe('https://feed/x.tar.zst');
    expect(seen?.key).toBe('CONFIG-KEY');
    expect(c.text()).toContain(`installed ${ID}`);
  });

  test('remote URL install uses the baked release anchor when no self-hosted key is configured', async () => {
    const c = capture(makeTmpDir());
    let seenKey: string | undefined;
    const deps = {
      ...c.deps,
      installUrl: async (_root: string, _url: string, key: string) => {
        seenKey = key;
        return { id: ID, installed: true };
      },
    };
    expect(await runEngine({ action: 'install', source: 'https://feed/x.tar.zst' }, deps)).toBe(0);
    expect(seenKey).toContain('BEGIN PUBLIC KEY');
    expect(c.text()).toContain(`installed ${ID}`);
  });

  test('a bare engine-id resolves to the official feed artifact url', async () => {
    const c = capture(makeTmpDir());
    let seenUrl: string | undefined;
    const deps = {
      ...c.deps,
      installUrl: async (_root: string, url: string, _key: string) => {
        seenUrl = url;
        return { id: ID, installed: true };
      },
    };
    expect(await runEngine({ action: 'install', source: ID }, deps)).toBe(0);
    expect(seenUrl).toBe(`https://engines.bunmaska.org/${ID}.tar.zst`);
    expect(c.text()).toContain(`installed ${ID}`);
  });

  test('a self-hosted feed url in config replaces the default feed for a bare id', async () => {
    const c = capture(makeTmpDir(), { engine: { feed: { url: 'https://mirror.example/e' } } });
    let seenUrl: string | undefined;
    const deps = {
      ...c.deps,
      installUrl: async (_root: string, url: string, _key: string) => {
        seenUrl = url;
        return { id: ID, installed: true };
      },
    };
    expect(await runEngine({ action: 'install', source: ID }, deps)).toBe(0);
    expect(seenUrl).toBe(`https://mirror.example/e/${ID}.tar.zst`);
  });

  test('an already-installed bare id is a no-op — it does not re-download', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    const c = capture(root);
    let fetched = false;
    const deps = {
      ...c.deps,
      installUrl: async () => {
        fetched = true;
        return { id: ID, installed: false };
      },
    };
    expect(await runEngine({ action: 'install', source: ID }, deps)).toBe(0);
    expect(fetched).toBe(false);
    expect(c.text()).toMatch(/already installed/i);
  });

  test('a local directory is installed locally even when its config would route to a feed', async () => {
    const root = makeTmpDir();
    const src = makeEngineDir(root, ID);
    // A broken config must NOT break a local-directory install (config is only read for feed installs).
    const c = capture(root);
    let usedFeed = false;
    const deps = {
      ...c.deps,
      readConfig: async () => {
        throw new Error('bunmaska.config is broken');
      },
      installUrl: async () => {
        usedFeed = true;
        return { id: ID, installed: false };
      },
    };
    expect(await runEngine({ action: 'install', source: src }, deps)).toBe(0);
    expect(usedFeed).toBe(false);
    expect(c.text()).toContain(`installed ${ID}`);
  });
});

describe('engine use', () => {
  test('prints a per-project snippet and never offers a global switch', async () => {
    const c = capture(makeTmpDir());
    expect(await runEngine({ action: 'use', id: ID }, c.deps)).toBe(0);
    const text = c.text();
    expect(text).toContain('per-project');
    expect(text).toContain(ID);
    expect(text).not.toMatch(/global switch is|--global/);
  });

  test('rejects a malformed id', async () => {
    const c = capture(makeTmpDir());
    expect(await runEngine({ action: 'use', id: 'nope' }, c.deps)).toBe(1);
  });
});

describe('engine prune', () => {
  test('dry-run reports but deletes nothing', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    const c = capture(root);
    await runEngine({ action: 'prune', dryRun: true, force: false }, c.deps);
    expect(c.text()).toMatch(/dry run/i);
    expect(c.text()).toContain(ID);
    expect(c.deps.root && (await import('node:fs')).existsSync(`${root}/${ID}`)).toBeTruthy();
  });

  test('refuses to wipe the whole store when no app has registered (no --force)', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    const c = capture(root);
    await runEngine({ action: 'prune', dryRun: false, force: false }, c.deps);
    expect(c.text()).toMatch(/Refusing to prune/);
    const { existsSync } = await import('node:fs');
    expect(existsSync(`${root}/${ID}`)).toBe(true);
  });

  test('--force prunes the unreferenced engine', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    const c = capture(root);
    await runEngine({ action: 'prune', dryRun: false, force: true }, c.deps);
    const { existsSync } = await import('node:fs');
    expect(existsSync(`${root}/${ID}`)).toBe(false);
  });
});

describe('engine verify', () => {
  test('ok for a healthy engine, fail for an absent one', async () => {
    const root = makeTmpDir();
    await installFromDir(root, makeEngineDir(root, ID));
    const ok = capture(root);
    expect(await runEngine({ action: 'verify', id: ID }, ok.deps)).toBe(0);
    const bad = capture(root);
    expect(await runEngine({ action: 'verify', id: ID2 }, bad.deps)).toBe(1);
  });
});

describe('doctor', () => {
  test('reports the runtime, store, and a clean system project (exit 0)', async () => {
    const c = capture(makeTmpDir(), {});
    expect(await runDoctor(undefined, c.deps)).toBe(0);
    expect(c.text()).toMatch(/Bunmaska doctor/);
    expect(c.text()).toMatch(/store:/);
  });

  test('exits 1 when the project pins an uninstalled engine', async () => {
    const c = capture(makeTmpDir(), { engine: { webkit: ID } });
    expect(await runDoctor('.', c.deps)).toBe(1);
    expect(c.err.join('\n')).toContain(ID);
  });
});
