import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentHash } from '../../../src/common/manifest';
import { generateSigningKeyPair, signArtifact } from '../../../src/cli/engine-signature';
import { engineDir, isInstalled } from '../../../src/cli/engine-store';
import {
  installFromUrl,
  parseRemoteManifest,
  type RemoteFetch,
} from '../../../src/cli/engine-remote';

const ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-remote-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Build a real `.tar.zst` of an engine tree (lib/ + engine.json). */
const buildArtifact = async (parent: string): Promise<Uint8Array> => {
  const src = join(parent, 'engine-src');
  mkdirSync(join(src, 'lib'), { recursive: true });
  writeFileSync(join(src, 'lib', 'libwebkitgtk-6.0.so.4'), 'PRETEND-SO');
  writeFileSync(
    join(src, 'engine.json'),
    JSON.stringify({ id: ID, soname: 'libwebkitgtk-6.0.so.4' }),
  );
  const tar = Bun.spawn(['tar', '-cf', '-', '-C', src, '.'], { stdout: 'pipe' });
  const tarBytes = new Uint8Array(await new Response(tar.stdout).arrayBuffer());
  await tar.exited;
  return Bun.zstdCompressSync(tarBytes);
};

/** A fixture feed: maps the three artifact URLs to their bytes. */
const fixtureFeed = (
  artifact: Uint8Array,
  manifestText: string,
  signature: string,
): RemoteFetch => {
  const base = 'https://feed.example/webkit.tar.zst';
  return async (url) => {
    if (url === base) return artifact;
    if (url === `${base}.json`) return new TextEncoder().encode(manifestText);
    if (url === `${base}.sig`) return new TextEncoder().encode(signature);
    throw new Error(`unexpected url ${url}`);
  };
};

describe('parseRemoteManifest', () => {
  test('requires id + hash strings', () => {
    expect(parseRemoteManifest('{"id":"x","hash":"abc"}')).toEqual({ id: 'x', hash: 'abc' });
    expect(() => parseRemoteManifest('{"id":"x"}')).toThrow(/hash/);
    expect(() => parseRemoteManifest('not json')).toThrow(/JSON/);
  });
});

describe('installFromUrl', () => {
  const base = 'https://feed.example/webkit.tar.zst';

  // Uses the real default extract, which shells out to GNU `tar` with a Windows
  // destination path the tool cannot open; fixing that is a src concern, not a test one.
  test.skipIf(process.platform === 'win32')(
    'verifies the signature + hash, extracts, and installs from a feed',
    async () => {
      const root = makeTmpDir();
      const work = makeTmpDir();
      const artifact = await buildArtifact(work);
      const hash = contentHash(artifact);
      const { publicKey, privateKey } = generateSigningKeyPair();
      const manifest = JSON.stringify({ id: ID, hash });
      const sig = signArtifact(privateKey, artifact);

      const result = await installFromUrl(root, base, publicKey, {
        fetch: fixtureFeed(artifact, manifest, sig),
      });
      expect(result).toEqual({ id: ID, installed: true });
      expect(isInstalled(root, ID)).toBe(true);
      expect(existsSync(join(engineDir(root, ID), 'lib', 'libwebkitgtk-6.0.so.4'))).toBe(true);
    },
  );

  test('rejects a bad signature BEFORE extracting (no engine dir created)', async () => {
    const root = makeTmpDir();
    const work = makeTmpDir();
    const artifact = await buildArtifact(work);
    const hash = contentHash(artifact);
    const right = generateSigningKeyPair();
    const wrong = generateSigningKeyPair();
    const manifest = JSON.stringify({ id: ID, hash });
    const sig = signArtifact(wrong.privateKey, artifact); // signed by the WRONG key

    await expect(
      installFromUrl(root, base, right.publicKey, { fetch: fixtureFeed(artifact, manifest, sig) }),
    ).rejects.toThrow(/signature/i);
    expect(existsSync(engineDir(root, ID))).toBe(false);
  });

  test('rejects a hash mismatch even when the signature is valid', async () => {
    const root = makeTmpDir();
    const work = makeTmpDir();
    const artifact = await buildArtifact(work);
    const { publicKey, privateKey } = generateSigningKeyPair();
    const manifest = JSON.stringify({ id: ID, hash: 'deadbeefdeadbeef' }); // wrong hash
    const sig = signArtifact(privateKey, artifact);

    await expect(
      installFromUrl(root, base, publicKey, { fetch: fixtureFeed(artifact, manifest, sig) }),
    ).rejects.toThrow(/integrity|hash/i);
    expect(existsSync(engineDir(root, ID))).toBe(false);
  });
});
