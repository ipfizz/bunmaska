/**
 * os/arch/upstream/family are DERIVED from each entry's id at parse time, so the
 * stored index cannot disagree with the id. Layout at a feed:
 * `<base>/index.json`, beside each `<id>.tar.zst`.
 */

import { type EngineRef, parseEngineId } from '../common/engine-id';
import { BunmaskaError } from '../common/errors';
import { DEFAULT_ENGINE_FEED_URL, type RemoteFetch, type RemoteManifest } from './engine-remote';

export type EngineIndexEntry = EngineRef & {
  readonly id: string;
  readonly size?: number;
  readonly hash?: string;
  readonly soname?: string;
};

/** The raw, stored shape of one index entry (before id-derivation). */
type StoredEntry = {
  readonly id: string;
  readonly size?: number;
  readonly hash?: string;
  readonly soname?: string;
};

/** The `index.json` URL for a feed base (default: the official feed). */
export const engineFeedIndexUrl = (feedBase = DEFAULT_ENGINE_FEED_URL): string =>
  `${feedBase.replace(/\/+$/, '')}/index.json`;

const err = (message: string): never => {
  throw new BunmaskaError(message, { code: 'ERR_ENGINE_INDEX' });
};

export const parseEngineIndex = (text: string): EngineIndexEntry[] => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err('engine index: not valid JSON');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err('engine index: must be a JSON object with an "engines" array');
  }
  const engines = (raw as Record<string, unknown>)['engines'];
  if (!Array.isArray(engines)) {
    return err('engine index: "engines" must be an array');
  }
  return engines.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    if (typeof record['id'] !== 'string') {
      return err('engine index: every entry needs a string "id"');
    }
    const ref = parseEngineId(record['id']); // throws on a malformed id
    return {
      ...ref,
      id: record['id'],
      ...(typeof record['size'] === 'number' ? { size: record['size'] } : {}),
      ...(typeof record['hash'] === 'string' ? { hash: record['hash'] } : {}),
      ...(typeof record['soname'] === 'string' ? { soname: record['soname'] } : {}),
    };
  });
};

/** Serialize entries to the pretty, newline-terminated `index.json` a feed serves. */
export const buildEngineIndex = (entries: readonly StoredEntry[]): string => {
  const engines = entries.map((e) => ({
    id: e.id,
    ...(e.size !== undefined ? { size: e.size } : {}),
    ...(e.hash !== undefined ? { hash: e.hash } : {}),
    ...(e.soname !== undefined ? { soname: e.soname } : {}),
  }));
  return `${JSON.stringify({ version: 1, engines }, null, 2)}\n`;
};

export const fetchEngineIndex = async (
  feedBase: string,
  fetch: RemoteFetch,
): Promise<EngineIndexEntry[]> =>
  parseEngineIndex(new TextDecoder().decode(await fetch(engineFeedIndexUrl(feedBase))));

/**
 * Same-id entry replaced, everything else kept, output sorted by id.
 * `indexText` undefined means "no index published yet" and starts one.
 */
export const mergeEngineIndex = (
  indexText: string | undefined,
  manifest: RemoteManifest,
): string => {
  const existing = indexText === undefined ? [] : parseEngineIndex(indexText);
  parseEngineId(manifest.id); // reject a malformed id before it enters the index
  const entries = [
    ...existing.filter((e) => e.id !== manifest.id),
    {
      id: manifest.id,
      ...(manifest.size !== undefined ? { size: manifest.size } : {}),
      hash: manifest.hash,
      ...(manifest.soname !== undefined ? { soname: manifest.soname } : {}),
    },
  ].sort((a, b) => a.id.localeCompare(b.id));
  return buildEngineIndex(entries);
};
