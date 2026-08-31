/**
 * The producer side of {@link installFromUrl}. The three outputs map one-to-one
 * to the feed's three files (`<id>.tar.zst`, `.json`, `.sig`), so publishing is
 * a plain object upload.
 */

import { BunmaskaError } from '../common/errors';
import { contentHash } from '../common/manifest';
import { signArtifact } from './engine-signature';
import { type RemoteManifest, zstdTarExtract } from './engine-remote';
import { readEngineManifest } from './engine-store';

/** Compress a directory tree to `.tar.zst` bytes — the inverse of {@link zstdTarExtract}. */
export const zstdTarCompress = async (srcDir: string): Promise<Uint8Array> => {
  // tar from cwd:srcDir (not `-C <dir>`) — Windows bsdtar mangles a backslash path arg.
  // Exclude INSTALLATION_COMPLETE: it is a store-LOCAL marker written last by a
  // verified install, never shipped inside the artifact (would void the invariant).
  const proc = Bun.spawn(['tar', '--exclude', './INSTALLATION_COMPLETE', '-cf', '-', '.'], {
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

export type PackedEngine = {
  readonly artifact: Uint8Array;
  readonly manifest: RemoteManifest;
  readonly signature: string;
};

export type PackDeps = {
  readonly compress?: (srcDir: string) => Promise<Uint8Array>;
};

/**
 * The signature is detached base64 Ed25519 over the artifact bytes. Throws if
 * the dir has no readable `engine.json`.
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
