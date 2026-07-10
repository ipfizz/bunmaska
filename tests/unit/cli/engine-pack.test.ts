import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKeyPair } from '../../../src/cli/engine-signature';
import { packEngineDir } from '../../../src/cli/engine-pack';
import { installFromUrl, type RemoteFetch } from '../../../src/cli/engine-remote';
import { contentHash } from '../../../src/common/manifest';
import { engineDir, isInstalled } from '../../../src/cli/engine-store';

const ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';

const tmpDirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-pack-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A store-shaped engine dir: lib/<soname> + engine.json. */
const makeEngineDir = (soname = 'libwebkitgtk-6.0.so.4'): string => {
  const dir = join(makeTmpDir(), 'engine');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', soname), 'PRETEND-ENGINE-BYTES');
  writeFileSync(join(dir, 'engine.json'), JSON.stringify({ id: ID, soname }));
  return dir;
};

describe('packEngineDir', () => {
  test('produces a signed manifest whose hash matches the artifact bytes', async () => {
    const { privateKey } = generateSigningKeyPair();
    const packed = await packEngineDir(makeEngineDir(), privateKey);
    expect(packed.manifest.id).toBe(ID);
    expect(packed.manifest.soname).toBe('libwebkitgtk-6.0.so.4');
    expect(packed.manifest.size).toBe(packed.artifact.length);
    expect(packed.manifest.hash).toBe(contentHash(packed.artifact));
    expect(packed.signature.length).toBeGreaterThan(0);
  });

  test('the packed artifact round-trips through the real installFromUrl verify+install path', async () => {
    const { publicKey, privateKey } = generateSigningKeyPair();
    const packed = await packEngineDir(makeEngineDir(), privateKey);

    const base = `https://engines.bunmaska.org/${ID}.tar.zst`;
    const feed: Record<string, Uint8Array> = {
      [base]: packed.artifact,
      [`${base}.json`]: new TextEncoder().encode(JSON.stringify(packed.manifest)),
      [`${base}.sig`]: new TextEncoder().encode(packed.signature),
    };
    const fetch: RemoteFetch = async (url) => {
      const bytes = feed[url];
      if (bytes === undefined) throw new Error(`404 ${url}`);
      return bytes;
    };

    const store = makeTmpDir();
    const result = await installFromUrl(store, base, publicKey, { fetch });
    expect(result).toEqual({ id: ID, installed: true });
    expect(isInstalled(store, ID)).toBe(true);
    expect(existsSync(join(engineDir(store, ID), 'lib', 'libwebkitgtk-6.0.so.4'))).toBe(true);
  });

  test('rejects a dir with no readable engine.json', async () => {
    const { privateKey } = generateSigningKeyPair();
    const empty = makeTmpDir();
    await expect(packEngineDir(empty, privateKey)).rejects.toThrow(/engine\.json/i);
  });
});
