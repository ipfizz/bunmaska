// The producer side of `installFromUrl`: one output per feed file (`<id>.tar.zst`, .json, .sig).

import { parseEngineId } from '../common/engine-id';
import { BunmaskaError } from '../common/errors';
import { contentHash } from '../common/manifest';
import { signArtifact } from '../common/signature';
import { type RemoteManifest, zstdTarExtract } from './engine-remote';
import { readEngineManifest } from './engine-store';

/** The inverse of {@link zstdTarExtract}. */
export const zstdTarCompress = async (srcDir: string): Promise<Uint8Array> => {
  // tar from cwd:srcDir, never `-C <dir>`: Windows bsdtar mangles a backslash path arg.
  // Never pack INSTALLATION_COMPLETE: a store marks an engine installed only after verifying it.
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

/** Signs with a detached base64 Ed25519 signature over the artifact bytes. */
export const packEngineDir = async (
  engineDir: string,
  privateKeyPem: string,
  deps: PackDeps = {},
): Promise<PackedEngine> => {
  const manifest = readEngineManifest(engineDir);
  parseEngineId(manifest.id);
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
