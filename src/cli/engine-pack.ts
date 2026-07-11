/**
 * Pack a built engine directory into the signed feed artifact that
 * `bunmaska engine install <url>` consumes — the producer side of
 * {@link installFromUrl}. Reads a store-shaped engine dir (`lib/` + `engine.json`),
 * compresses it to `.tar.zst`, content-hashes the bytes, and signs them with the
 * release Ed25519 key. The three outputs map one-to-one to the feed's three files
 * (`<id>.tar.zst`, `.json`, `.sig`), so publishing is a plain object upload.
 *
 * Network + a real CDN are never needed to test this: the produced artifact
 * round-trips through the real `installFromUrl` verify path against an in-memory
 * feed (see `engine-pack.test.ts`).
 */

import { BunmaskaError } from '../common/errors';
import { contentHash } from '../common/manifest';
import { signArtifact } from './engine-signature';
import { type RemoteManifest, zstdTarExtract } from './engine-remote';
import { readEngineManifest } from './engine-store';

/** Compress a directory tree to `.tar.zst` bytes — the inverse of {@link zstdTarExtract}. */
export const zstdTarCompress = async (srcDir: string): Promise<Uint8Array> => {
  // tar from cwr:srcDir (not `-C <dir>`) — Windows bsdtar mangles a backslash path arg.
  const proc = Bun.spawn(['tar', '-cf', '-', '.'], {
    cwd: srcDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const tarBytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new BunmaskaError(`engine pack: tar exited ${code}: ${stderr}`, {
      code: 'ERR_ENGINE_PACK',
    });
  }
  return Bun.zstdCompressSync(tarBytes);
};

/** A packed engine ready to publish: the artifact bytes, its feed manifest, and its signature. */
export type PackedEngine = {
  readonly artifact: Uint8Array;
  readonly manifest: RemoteManifest;
  readonly signature: string;
};

/** Injectable side effects for {@link packEngineDir}. */
export type PackDeps = {
  readonly compress?: (srcDir: string) => Promise<Uint8Array>;
};

/**
 * Pack a store-shaped engine directory into a signed `.tar.zst` artifact plus its
 * feed manifest (`id`/`hash`/`size`/`soname`) and detached base64 Ed25519
 * signature. Throws if the dir has no readable `engine.json`.
 */
export const packEngineDir = async (
  engineDir: string,
  privateKeyPem: string,
  deps: PackDeps = {},
): Promise<PackedEngine> => {
  const manifest = readEngineManifest(engineDir);
  const compress = deps.compress ?? zstdTarCompress;
  const artifact = await compress(engineDir);
  const hash = contentHash(artifact);
  const signature = signArtifact(privateKeyPem, artifact);
  return {
    artifact,
    manifest: { id: manifest.id, hash, size: artifact.length, soname: manifest.soname },
    signature,
  };
};
