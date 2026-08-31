/**
 * Emits the auto-update feed for a built bundle: a `.tar.zst` of the `.app`/AppDir
 * plus the `update.json` manifest the runtime `autoUpdater` consumes.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  type ArtifactOs,
  type ArtifactSpec,
  artifactFileName,
  contentHash,
  serializeUpdateManifest,
  type UpdateManifest,
} from '../common/manifest';
import type { Arch } from '../common/platform';
import { signArtifact } from '../common/signature';

export type UpdateArtifactSpec = {
  /** Path to the built bundle (the `.app` directory or the Linux AppDir). */
  readonly bundlePath: string;
  /** Directory to write the `.tar.zst` and `update.json` into. */
  readonly outDir: string;
  readonly name: string;
  readonly version: string;
  readonly channel: string;
  readonly os: ArtifactOs;
  readonly arch: Arch;
  /** PEM Ed25519 private key; when set, a detached `.sig` is written beside the artifact. */
  readonly signingKeyPem?: string;
};

export type UpdateArtifactDeps = {
  readonly tarZst: (bundlePath: string, outPath: string) => Promise<void>;
  readonly readBytes: (path: string) => Uint8Array;
  readonly writeText: (path: string, text: string) => void;
};

const toArtifactSpec = (spec: UpdateArtifactSpec): ArtifactSpec => ({
  name: spec.name,
  channel: spec.channel,
  os: spec.os,
  arch: spec.arch,
});

export const buildUpdateManifest = (
  spec: UpdateArtifactSpec,
  bytes: Uint8Array,
): UpdateManifest => ({
  name: spec.name,
  version: spec.version,
  channel: spec.channel,
  os: spec.os,
  arch: spec.arch,
  hash: contentHash(bytes),
  size: bytes.length,
  artifact: artifactFileName(toArtifactSpec(spec), 'tar.zst'),
});

export type UpdateArtifactResult = {
  readonly artifactPath: string;
  readonly manifestPath: string;
  readonly manifest: UpdateManifest;
  /** Present only when the spec carried a signing key. */
  readonly sigPath?: string;
};

const tarThenZstd = async (bundlePath: string, outPath: string): Promise<void> => {
  // tar with the system tar (portable), then compress the tar bytes with Bun's
  // zstd — avoids depending on `tar --zstd` being present.
  const tarPath = outPath.replace(/\.zst$/, '');
  const proc = Bun.spawn(['tar', '-cf', tarPath, '-C', dirname(bundlePath), basename(bundlePath)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`update-artifact: tar exited with code ${code}`);
  }
  const tarBytes = readFileSync(tarPath);
  writeFileSync(outPath, Bun.zstdCompressSync(tarBytes));
  rmSync(tarPath, { force: true });
};

const defaultDeps: UpdateArtifactDeps = {
  tarZst: tarThenZstd,
  readBytes: (path) => readFileSync(path),
  writeText: (path, text) => {
    writeFileSync(path, text);
  },
};

export const emitUpdateArtifact = async (
  spec: UpdateArtifactSpec,
  deps: UpdateArtifactDeps = defaultDeps,
): Promise<UpdateArtifactResult> => {
  const artifactName = artifactFileName(toArtifactSpec(spec), 'tar.zst');
  const artifactPath = join(spec.outDir, artifactName);
  await deps.tarZst(spec.bundlePath, artifactPath);
  const bytes = deps.readBytes(artifactPath);
  const manifest = buildUpdateManifest(spec, bytes);
  const manifestPath = join(spec.outDir, 'update.json');
  deps.writeText(manifestPath, serializeUpdateManifest(manifest));
  if (spec.signingKeyPem === undefined) {
    return { artifactPath, manifestPath, manifest };
  }
  // Same detached format the runtime autoUpdater fetches as `<artifact>.sig`.
  const sigPath = `${artifactPath}.sig`;
  deps.writeText(sigPath, `${signArtifact(spec.signingKeyPem, bytes)}\n`);
  return { artifactPath, manifestPath, manifest, sigPath };
};
