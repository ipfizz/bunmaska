/**
 * Remote engine install for `bunmaska engine install <url>`: fetch a published
 * `.tar.zst` + its `.json` manifest + its `.sig`, verify the Ed25519 signature
 * against the release public key, then hand the bytes to the store's
 * {@link installFromSource} (which re-checks the content hash, extracts, and
 * writes the marker last). Network + decompression are injectable seams so the
 * whole path is tested against a local fixture feed — no real CDN needed.
 *
 * Artifact layout at a feed: `<base>` (the `.tar.zst`), `<base>.json`, `<base>.sig`.
 */

import { BunmaskaError } from '../common/errors';
import { installFromSource, type InstallResult } from './engine-store';
import { verifyArtifact } from './engine-signature';

/**
 * The official Bunmaska engine feed. Engines are published at
 * `<base>/<engine-id>.tar.zst` (plus `.json` + `.sig`), so an engine-id maps to
 * a URL with no directory index needed. A self-hosted mirror overrides this via
 * `bunmaska.config` `engine.feed.url`.
 */
export const DEFAULT_ENGINE_FEED_URL = 'https://engines.bunmaska.org';

/** The artifact URL base for an engine-id at a feed (default: the official feed). */
export const engineFeedArtifactUrl = (id: string, feedBase = DEFAULT_ENGINE_FEED_URL): string =>
  `${feedBase.replace(/\/+$/, '')}/${id}.tar.zst`;

/** Download the bytes at a URL (default: `fetch`). */
export type RemoteFetch = (url: string) => Promise<Uint8Array>;

/** The manifest published beside an engine artifact. */
export type RemoteManifest = {
  readonly id: string;
  readonly hash: string;
  readonly size?: number;
  readonly soname?: string;
};

/** Parse + validate an engine feed manifest. Throws on malformed JSON/fields. */
export const parseRemoteManifest = (text: string): RemoteManifest => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BunmaskaError('engine manifest: not valid JSON', { code: 'ERR_ENGINE_MANIFEST' });
  }
  const record = (raw ?? {}) as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || typeof record['hash'] !== 'string') {
    throw new BunmaskaError('engine manifest: "id" and "hash" must be strings', {
      code: 'ERR_ENGINE_MANIFEST',
    });
  }
  return {
    id: record['id'],
    hash: record['hash'],
    ...(typeof record['size'] === 'number' ? { size: record['size'] } : {}),
    ...(typeof record['soname'] === 'string' ? { soname: record['soname'] } : {}),
  };
};

/** Decompress a `.tar.zst` byte stream and extract its tree into `destDir`. */
export const zstdTarExtract = async (bytes: Uint8Array, destDir: string): Promise<void> => {
  const tarBytes = Bun.zstdDecompressSync(bytes);
  // extract via cwd, not `-C <dir>` — Windows bsdtar mangles backslash paths
  const proc = Bun.spawn(['tar', '-xf', '-'], {
    cwd: destDir,
    stdin: tarBytes,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new BunmaskaError(`engine extract: tar exited ${code}: ${stderr}`, {
      code: 'ERR_ENGINE_EXTRACT',
    });
  }
};

/** Injectable side effects for {@link installFromUrl}. */
export type RemoteInstallDeps = {
  readonly fetch: RemoteFetch;
  readonly extract?: (bytes: Uint8Array, destDir: string) => Promise<void>;
};

/**
 * Install an engine from a feed: fetch artifact + manifest + signature, verify
 * the signature against `publicKeyPem`, then install via the store (which
 * re-verifies the content hash and writes the marker last). Throws before any
 * extraction if the signature does not verify.
 */
export const installFromUrl = async (
  root: string,
  baseUrl: string,
  publicKeyPem: string,
  deps: RemoteInstallDeps,
): Promise<InstallResult> => {
  const bytes = await deps.fetch(baseUrl);
  const manifest = parseRemoteManifest(
    new TextDecoder().decode(await deps.fetch(`${baseUrl}.json`)),
  );
  const signature = new TextDecoder().decode(await deps.fetch(`${baseUrl}.sig`)).trim();
  if (!verifyArtifact(publicKeyPem, bytes, signature)) {
    throw new BunmaskaError(`engine ${manifest.id}: signature verification failed`, {
      code: 'ERR_ENGINE_SIGNATURE',
    });
  }
  return installFromSource(
    root,
    { id: manifest.id, bytes, expectedHash: manifest.hash },
    { extract: deps.extract ?? zstdTarExtract },
  );
};

/** Default network fetch returning raw bytes (used by the CLI; not in tests). */
export const defaultRemoteFetch: RemoteFetch = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new BunmaskaError(`engine install: GET ${url} -> ${response.status}`, {
      code: 'ERR_ENGINE_FETCH',
    });
  }
  return new Uint8Array(await response.arrayBuffer());
};
