/**
 * The Ed25519 signature is verified against the resolved feed key BEFORE the bytes reach
 * the store. Feed layout: `<base>` (the `.tar.zst`), `<base>.json`, `<base>.sig`.
 */

import { BunmaskaError } from '../common/errors';
import { fetchCapped } from '../common/feed-fetch';
import { verifyArtifact } from '../common/signature';
import { installFromSource, type InstallResult } from '../common/engine-store';

/**
 * The official feed. A self-hosted mirror overrides it via `bunmaska.config`
 * `engine.feed.url`.
 */
export const DEFAULT_ENGINE_FEED_URL = 'https://engines.bunmaska.org';

/** The artifact URL base for an engine-id at a feed (default: the official feed). */
export const engineFeedArtifactUrl = (id: string, feedBase = DEFAULT_ENGINE_FEED_URL): string =>
  `${feedBase.replace(/\/+$/, '')}/${id}.tar.zst`;

/** Download the bytes at a URL, rejecting a body past `maxBytes`. */
export type RemoteFetch = (url: string, maxBytes: number) => Promise<Uint8Array>;

/** Caps for a feed's `.json`, `.sig` and `index.json`, and for an artifact; past these is hostile. */
export const MAX_ENGINE_TEXT_BYTES = 1024 * 1024;
export const MAX_ENGINE_ARTIFACT_BYTES = 1024 * 1024 * 1024;

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

export const zstdTarExtract = async (bytes: Uint8Array, destDir: string): Promise<void> => {
  const tarBytes = Bun.zstdDecompressSync(bytes);
  // extract via cwd, not `-C <dir>`: Windows bsdtar mangles backslash paths
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

export type RemoteInstallDeps = {
  readonly fetch: RemoteFetch;
  readonly extract?: (bytes: Uint8Array, destDir: string) => Promise<void>;
  /** The id the user asked for; a feed serving another one fails before the download. */
  readonly expectedId?: string;
};

/**
 * Throws BEFORE any extraction if the signature does not verify against
 * `publicKeyPem`; the store then re-verifies the content hash.
 */
export const installFromUrl = async (
  root: string,
  baseUrl: string,
  publicKeyPem: string,
  deps: RemoteInstallDeps,
): Promise<InstallResult> => {
  const manifest = parseRemoteManifest(
    new TextDecoder().decode(await deps.fetch(`${baseUrl}.json`, MAX_ENGINE_TEXT_BYTES)),
  );
  if (deps.expectedId !== undefined && manifest.id !== deps.expectedId) {
    throw new BunmaskaError(
      `engine ${deps.expectedId}: the feed serves ${JSON.stringify(manifest.id)} instead`,
      { code: 'ERR_ENGINE_MANIFEST' },
    );
  }
  const signature = new TextDecoder()
    .decode(await deps.fetch(`${baseUrl}.sig`, MAX_ENGINE_TEXT_BYTES))
    .trim();
  const bytes = await deps.fetch(baseUrl, MAX_ENGINE_ARTIFACT_BYTES);
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

export const defaultRemoteFetch: RemoteFetch = fetchCapped;
