import { describe, expect, test } from 'bun:test';
import {
  AutoUpdaterImpl,
  type AutoUpdaterDeps,
  type StagedUpdate,
} from '../../../../src/main/api/auto-updater';
import {
  contentHash,
  serializeUpdateManifest,
  type UpdateManifest,
} from '../../../../src/common/manifest';
import { generateSigningKeyPair, signArtifact } from '../../../../src/common/signature';

const ARTIFACT = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
const ARTIFACT_HASH = contentHash(ARTIFACT);
const TAR = new Uint8Array([1, 2, 3]);

// The publisher's release key. A downloaded artifact's `.sig` must verify against
// its public half, so the feed serves a `.sig` signed by the private half.
const KEYS = generateSigningKeyPair();
const SIG = signArtifact(KEYS.privateKey, ARTIFACT);
const FEED = { url: 'https://feed', publicKey: KEYS.publicKey };

const manifest = (version: string): UpdateManifest => ({
  name: 'My App',
  version,
  channel: 'stable',
  os: 'macos',
  arch: 'arm64',
  hash: ARTIFACT_HASH,
  size: ARTIFACT.length,
  artifact: 'my-app-stable-macos-arm64.tar.zst',
});

type Harness = {
  updater: AutoUpdaterImpl;
  staged: StagedUpdate[];
  decompressed: Uint8Array[];
  events: string[];
};

const makeUpdater = (overrides: Partial<AutoUpdaterDeps>, feedVersion = '2.0.0'): Harness => {
  const staged: StagedUpdate[] = [];
  const decompressed: Uint8Array[] = [];
  const events: string[] = [];
  const deps: Partial<AutoUpdaterDeps> = {
    fetchText: async (url) =>
      url.endsWith('.sig') ? SIG : serializeUpdateManifest(manifest(feedVersion)),
    fetchBytes: async () => ARTIFACT,
    currentVersion: () => '1.0.0',
    decompress: (bytes) => {
      decompressed.push(bytes);
      return TAR;
    },
    stage: async (_tar, m) => `/tmp/bunmaska-update-${m.hash}.tar`,
    install: (s) => {
      staged.push(s);
    },
    ...overrides,
  };
  const updater = new AutoUpdaterImpl(deps);
  for (const name of [
    'checking-for-update',
    'update-available',
    'update-not-available',
    'update-downloaded',
  ]) {
    updater.on(name, () => events.push(name));
  }
  updater.on('error', () => events.push('error'));
  return { updater, staged, decompressed, events };
};

describe('autoUpdater.setFeedURL / getFeedURL', () => {
  test('accepts a string or an options object', () => {
    const { updater } = makeUpdater({});
    updater.setFeedURL('https://feed/stable');
    expect(updater.getFeedURL()).toBe('https://feed/stable');
    updater.setFeedURL({ url: 'https://feed/canary' });
    expect(updater.getFeedURL()).toBe('https://feed/canary');
  });

  test('rejects an empty url', () => {
    const { updater } = makeUpdater({});
    expect(() => updater.setFeedURL('')).toThrow(/non-empty url/);
  });

  test('rejects a non-HTTPS feed url', () => {
    const { updater } = makeUpdater({});
    expect(() => updater.setFeedURL('http://evil.example/feed')).toThrow(/https/i);
  });

  test('rejects a malformed url', () => {
    const { updater } = makeUpdater({});
    expect(() => updater.setFeedURL('not a url')).toThrow(/invalid url/i);
  });

  test('allows http only for a localhost dev feed', () => {
    const { updater } = makeUpdater({});
    updater.setFeedURL('http://localhost:8080/feed');
    expect(updater.getFeedURL()).toBe('http://localhost:8080/feed');
  });

  test('getFeedURL is empty before configuration', () => {
    expect(makeUpdater({}).updater.getFeedURL()).toBe('');
  });
});

describe('autoUpdater.checkForUpdates', () => {
  test('throws when the feed URL is not set', () => {
    const { updater } = makeUpdater({});
    expect(updater.checkForUpdates()).rejects.toThrow(/feed URL is not set/);
  });

  test('emits update-available and returns the result for a newer version', async () => {
    const h = makeUpdater({}, '2.0.0');
    h.updater.setFeedURL('https://feed');
    const result = await h.updater.checkForUpdates();
    expect(result?.updateInfo).toEqual({ version: '2.0.0', releaseName: 'My App' });
    expect(h.events).toEqual(['checking-for-update', 'update-available']);
  });

  test('emits update-not-available and returns null for an equal/older version', async () => {
    const h = makeUpdater({}, '1.0.0');
    h.updater.setFeedURL('https://feed');
    expect(await h.updater.checkForUpdates()).toBeNull();
    expect(h.events).toEqual(['checking-for-update', 'update-not-available']);
  });

  test('emits error and rejects on a network failure', async () => {
    const h = makeUpdater({
      fetchText: async () => {
        throw new Error('offline');
      },
    });
    h.updater.setFeedURL('https://feed');
    await expect(h.updater.checkForUpdates()).rejects.toThrow('offline');
    expect(h.events).toEqual(['checking-for-update', 'error']);
  });

  test('rejects a malformed (non-JSON) manifest', async () => {
    const h = makeUpdater({ fetchText: async () => '<html>nope</html>' });
    h.updater.setFeedURL('https://feed');
    await expect(h.updater.checkForUpdates()).rejects.toThrow(/not valid JSON/);
  });
});

describe('autoUpdater.downloadUpdate', () => {
  test('rejects when no update has been checked', async () => {
    const h = makeUpdater({});
    h.updater.setFeedURL('https://feed');
    await expect(h.updater.downloadUpdate()).rejects.toThrow(/no update available/);
  });

  test('refuses to download when no public key is configured (unsigned updates)', async () => {
    const h = makeUpdater({}, '2.0.0');
    h.updater.setFeedURL('https://feed');
    await h.updater.checkForUpdates();
    await expect(h.updater.downloadUpdate()).rejects.toThrow(/public key/i);
    expect(h.events).toContain('error');
  });

  test('verifies signature + hash, decompresses, stages, and emits update-downloaded', async () => {
    const h = makeUpdater({}, '2.0.0');
    h.updater.setFeedURL(FEED);
    await h.updater.checkForUpdates();
    const staged = await h.updater.downloadUpdate();
    expect(staged.manifest.version).toBe('2.0.0');
    expect(staged.tarPath).toContain(ARTIFACT_HASH);
    expect(h.decompressed[0]).toEqual(ARTIFACT);
    expect(h.events).toContain('update-downloaded');
  });

  test('rejects an artifact whose signature does not verify against the public key', async () => {
    const h = makeUpdater({}, '2.0.0');
    h.updater.setFeedURL({ url: 'https://feed', publicKey: generateSigningKeyPair().publicKey });
    await h.updater.checkForUpdates();
    await expect(h.updater.downloadUpdate()).rejects.toThrow(/signature/i);
    expect(h.events).toContain('error');
  });

  test('rejects + emits error on an artifact size mismatch', async () => {
    const h = makeUpdater({ fetchBytes: async () => new Uint8Array([1, 2]) }, '2.0.0');
    h.updater.setFeedURL(FEED);
    await h.updater.checkForUpdates();
    await expect(h.updater.downloadUpdate()).rejects.toThrow(/size mismatch/);
    expect(h.events).toContain('error');
  });

  test('rejects on an artifact hash mismatch', async () => {
    const wrong = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]); // same length, different bytes
    const h = makeUpdater({ fetchBytes: async () => wrong }, '2.0.0');
    h.updater.setFeedURL(FEED);
    await h.updater.checkForUpdates();
    await expect(h.updater.downloadUpdate()).rejects.toThrow(/hash mismatch/);
  });
});

describe('autoUpdater.quitAndInstall', () => {
  test('throws when nothing is staged', () => {
    const { updater } = makeUpdater({});
    expect(() => updater.quitAndInstall()).toThrow(/no update downloaded/);
  });

  test('delegates the staged update to the installer', async () => {
    const h = makeUpdater({}, '2.0.0');
    h.updater.setFeedURL(FEED);
    await h.updater.checkForUpdates();
    await h.updater.downloadUpdate();
    h.updater.quitAndInstall();
    expect(h.staged).toHaveLength(1);
    expect(h.staged[0]?.manifest.version).toBe('2.0.0');
  });
});
