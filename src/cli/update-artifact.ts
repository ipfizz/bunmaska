/**
 * Emit the auto-update feed for a built bundle: a compressed `.tar.zst` of the
 * `.app`/AppDir plus the `update.json` manifest the runtime `autoUpdater`
 * consumes. The tar is produced with the system `tar` and compressed with
 * `Bun.zstdCompressSync` (portable — no reliance on `tar --zstd`); the manifest
 * is built from the same {@link ../common/manifest} contract.
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

/** Inputs needed to emit an update artifact for a finished bundle. */
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
};

/** Injectable side effects so the manifest emission is unit-testable. */
export type UpdateArtifactDeps = {
  /** Produce a `.tar.zst` of `bundlePath` at `outPath`. */
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

/** Build the {@link UpdateManifest} for a spec and the artifact's bytes. Pure. */
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

/** The result of {@link emitUpdateArtifact}. */
export type UpdateArtifactResult = {
  readonly artifactPath: string;
  readonly manifestPath: string;
  readonly manifest: UpdateManifest;
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

/**
 * Compress `bundlePath` into a channel-named `.tar.zst` under `outDir`, then
 * write `update.json` describing it. Returns both paths and the manifest.
 */
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
  return { artifactPath, manifestPath, manifest };
};
