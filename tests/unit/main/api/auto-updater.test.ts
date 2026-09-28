import { describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  assertSizeWithin,
  AutoUpdaterImpl,
  type AutoUpdaterDeps,
  MAX_COMPRESSED_ARTIFACT_BYTES,
  MAX_DECOMPRESSED_TAR_BYTES,
  readFeedResponse,
  type StagedUpdate,
  stageToTmp,
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

/** A feed serving `m` as update.json, signed by the publisher key, plus the artifact `.sig`. */
const signedFeed =
  (m: UpdateManifest, manifestSignedAs: UpdateManifest = m) =>
  async (url: string): Promise<string> => {
    if (url.endsWith('update.json.sig')) {
      const signed = new TextEncoder().encode(serializeUpdateManifest(manifestSignedAs));
      return signArtifact(KEYS.privateKey, signed);
    }
    return url.endsWith('.sig') ? SIG : serializeUpdateManifest(m);
  };

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
    fetchText: signedFeed(manifest(feedVersion)),
    fetchBytes: async () => ARTIFACT,
    currentVersion: () => '1.0.0',
    currentOs: () => 'macos',
    currentArch: () => 'arm64',
    decompress: async (bytes) => {
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

  test('refuses to check while the running version is unknown (0.0.0), which would reinstall forever', async () => {
    const h = makeUpdater({ currentVersion: () => '0.0.0' }, '2.0.0');
    h.updater.setFeedURL(FEED);
    await expect(h.updater.checkForUpdates()).rejects.toThrow(/version/);
    expect(h.events).not.toContain('update-available');
    expect(h.events).toContain('error');
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

  test('rejects an update built for another os/arch', async () => {
    const h = makeUpdater({ currentOs: () => 'linux' }, '2.0.0'); // manifest targets macos
    h.updater.setFeedURL('https://feed');
    await expect(h.updater.checkForUpdates()).rejects.toThrow(/macos.*linux|linux.*build/i);
    expect(h.events).toContain('error');
  });

  test('rejects an update on a different channel than configured', async () => {
    const h = makeUpdater({}, '2.0.0'); // manifest channel is "stable"
    h.updater.setFeedURL({ url: 'https://feed', publicKey: KEYS.publicKey, channel: 'canary' });
    await expect(h.updater.checkForUpdates()).rejects.toThrow(/channel/i);
    expect(h.events).toContain('error');
  });

  test('accepts a matching configured channel', async () => {
    const h = makeUpdater({}, '2.0.0');
    h.updater.setFeedURL({ url: 'https://feed', publicKey: KEYS.publicKey, channel: 'stable' });
    const result = await h.updater.checkForUpdates();
    expect(result?.updateInfo.version).toBe('2.0.0');
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

  test('refuses a re-labelled update.json before fetching the artifact (rollback guard)', async () => {
    let fetched = false;
    const h = makeUpdater(
      {
        // A genuinely signed 2.0.0 release re-served under a forged version.
        fetchText: signedFeed(manifest('99.0.0'), manifest('2.0.0')),
        fetchBytes: async () => {
          fetched = true;
          return ARTIFACT;
        },
      },
      '99.0.0',
    );
    h.updater.setFeedURL(FEED);
    await h.updater.checkForUpdates();
    await expect(h.updater.downloadUpdate()).rejects.toThrow(/update\.json signature/);
    expect(fetched).toBe(false);
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

  test('refuses an artifact whose declared size exceeds the compressed cap', async () => {
    let fetched = false;
    const h = makeUpdater(
      {
        fetchText: signedFeed({ ...manifest('2.0.0'), size: MAX_COMPRESSED_ARTIFACT_BYTES + 1 }),
        fetchBytes: async () => {
          fetched = true;
          return ARTIFACT;
        },
      },
      '2.0.0',
    );
    h.updater.setFeedURL(FEED);
    await h.updater.checkForUpdates();
    await expect(h.updater.downloadUpdate()).rejects.toThrow(/exceeds|limit/i);
    expect(fetched).toBe(false); // rejected before spending the download
  });
});

describe('assertSizeWithin (zip-bomb guard)', () => {
  test('passes at or below the cap and throws above it', () => {
    expect(() => assertSizeWithin(100, 100, 'thing')).not.toThrow();
    expect(() => assertSizeWithin(101, 100, 'thing')).toThrow(/exceeds/);
  });

  test('the decompressed cap is larger than the compressed cap', () => {
    expect(MAX_DECOMPRESSED_TAR_BYTES).toBeGreaterThan(MAX_COMPRESSED_ARTIFACT_BYTES);
  });
});

describe('autoUpdater fire-and-forget calls (Electron style)', () => {
  test('a failure reaches the error listener without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const h = makeUpdater({
        fetchText: async () => {
          throw new Error('offline');
        },
      });
      h.updater.setFeedURL(FEED);
      h.updater.checkForUpdates();
      h.updater.downloadUpdate();
      await Bun.sleep(10);
      expect(h.events.filter((e) => e === 'error')).toHaveLength(2);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
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

describe('stageToTmp', () => {
  test('writes the tar into a fresh private directory, never a guessable shared path', async () => {
    const a = await stageToTmp(TAR);
    const b = await stageToTmp(TAR);
    try {
      expect(dirname(a)).not.toBe(dirname(b));
      expect(new Uint8Array(readFileSync(a))).toEqual(TAR);
      if (process.platform !== 'win32') {
        expect(statSync(dirname(a)).mode & 0o777).toBe(0o700);
      }
    } finally {
      rmSync(dirname(a), { recursive: true, force: true });
      rmSync(dirname(b), { recursive: true, force: true });
    }
  });
});

describe('readFeedResponse', () => {
  const KIB = new Uint8Array(1024);

  test('rejects a body past the cap without draining the rest of the stream', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1000) {
          controller.close();
        } else {
          controller.enqueue(KIB);
        }
      },
    });
    await expect(readFeedResponse(new Response(body), 'https://feed/a', 4 * 1024)).rejects.toThrow(
      /exceeds/,
    );
    expect(pulls).toBeLessThan(10);
  });

  test('returns a body within the cap', async () => {
    const bytes = await readFeedResponse(new Response(KIB), 'https://feed/a', 1024);
    expect(bytes.length).toBe(1024);
  });

  test('refuses a response that was redirected off https', async () => {
    const response = new Response('{}');
    Object.defineProperty(response, 'url', { value: 'http://evil.example/update.json' });
    await expect(readFeedResponse(response, 'https://feed/update.json', 1024)).rejects.toThrow(
      /http:\/\/evil\.example/,
    );
  });
});
