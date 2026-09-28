/** `build --update`: the feed's `.tar.zst` and `update.json`, plus a `.sig` for each when signing. */

import { readFileSync, writeFileSync } from 'node:fs';
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
  /** PEM Ed25519 private key; when set, `.sig`s are written beside the artifact and `update.json`. */
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
  /** `update.json.sig`; present only when the spec carried a signing key. */
  readonly manifestSigPath?: string;
};

const tarThenZstd = async (bundlePath: string, outPath: string): Promise<void> => {
  // A relative entry from cwd, never an absolute path: GNU tar on Windows reads C:\... as a remote host.
  const proc = Bun.spawn(['tar', '-cf', '-', basename(bundlePath)], {
    cwd: dirname(bundlePath),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const tarBytes = await new Response(proc.stdout).bytes();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`update-artifact: tar exited with code ${code}`);
  }
  writeFileSync(outPath, Bun.zstdCompressSync(tarBytes));
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
  const manifestText = serializeUpdateManifest(manifest);
  const manifestPath = join(spec.outDir, 'update.json');
  if (spec.signingKeyPem === undefined) {
    deps.writeText(manifestPath, manifestText);
    return { artifactPath, manifestPath, manifest };
  }
  // Sign before writing so a bad key leaves no unsigned update.json behind.
  const artifactSig = signArtifact(spec.signingKeyPem, bytes);
  const manifestSig = signArtifact(spec.signingKeyPem, new TextEncoder().encode(manifestText));
  // Same detached format the runtime autoUpdater fetches as `<file>.sig`.
  const sigPath = `${artifactPath}.sig`;
  const manifestSigPath = `${manifestPath}.sig`;
  deps.writeText(manifestPath, manifestText);
  deps.writeText(sigPath, `${artifactSig}\n`);
  deps.writeText(manifestSigPath, `${manifestSig}\n`);
  return { artifactPath, manifestPath, manifest, sigPath, manifestSigPath };
};
