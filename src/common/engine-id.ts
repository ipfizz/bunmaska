/**
 * The content address of one pinned engine build. Many engine versions coexist in
 * the store and the WebKitGTK 6.0 soname (`libwebkitgtk-6.0.so.4`) is shared across
 * every upstream release, so the id — not the soname — carries the version.
 *
 * Format: `<engine>-<api>-<upstream>-<rev>-<os>-<arch>` (e.g.
 * `webkitgtk-6.0-2.52.4-bunmaska1-linux-x64`) where NO field may contain a dash, so
 * it splits unambiguously. `'system'` is a reserved sentinel meaning "use the OS
 * WebView" and is never a parseable id.
 */

import { InvalidArgumentError } from './errors';
import { compareVersions } from './manifest';
import type { Arch } from './platform';

/** Which web-engine family a build belongs to (`webkit` covers WinCairo + macOS; D044). */
export type EngineFamily = 'webkitgtk' | 'webkit';

export type EngineOs = 'linux' | 'macos' | 'windows';

/** The structured form of an engine-id. */
export type EngineRef = {
  readonly engine: EngineFamily;
  /** API/soname generation, e.g. `6.0`. */
  readonly api: string;
  /** Upstream WebKit release, e.g. `2.52.4` (dotted numeric). */
  readonly upstream: string;
  /** Bunmaska build revision of that upstream, e.g. `bunmaska1`. */
  readonly rev: string;
  readonly os: EngineOs;
  readonly arch: Arch;
};

/** The reserved sentinel meaning "use the OS WebView" (the default). */
export const SYSTEM_ENGINE = 'system';

const ENGINE_FAMILIES: ReadonlySet<string> = new Set(['webkitgtk', 'webkit']);
const ENGINE_OSES: ReadonlySet<string> = new Set(['linux', 'macos', 'windows']);
const ENGINE_ARCHES: ReadonlySet<string> = new Set(['x64', 'arm64']);

/** Whether `id` is the reserved system sentinel (case-insensitive). */
export const isSystemEngine = (id: string): boolean => id.trim().toLowerCase() === SYSTEM_ENGINE;

const assertNoDash = (value: string, field: string): void => {
  if (value.length === 0 || value.includes('-')) {
    throw new InvalidArgumentError(
      `engine-id: "${field}" must be non-empty and contain no dash (got ${JSON.stringify(value)})`,
    );
  }
};

/** Format an {@link EngineRef} into its flat engine-id string. Throws on a dashed field. */
export const formatEngineId = (ref: EngineRef): string => {
  assertNoDash(ref.api, 'api');
  assertNoDash(ref.upstream, 'upstream');
  assertNoDash(ref.rev, 'rev');
  return `${ref.engine}-${ref.api}-${ref.upstream}-${ref.rev}-${ref.os}-${ref.arch}`;
};

/**
 * Parse a flat engine-id back into an {@link EngineRef}, validating every field.
 * Throws {@link InvalidArgumentError} on the system sentinel or any malformed id.
 */
export const parseEngineId = (id: string): EngineRef => {
  const parts = id.split('-');
  if (parts.length !== 6) {
    throw new InvalidArgumentError(
      `engine-id: expected 6 dash-separated fields, got ${parts.length} in ${JSON.stringify(id)}`,
    );
  }
  const [engine, api, upstream, rev, os, arch] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (!ENGINE_FAMILIES.has(engine)) {
    throw new InvalidArgumentError(`engine-id: unknown engine family ${JSON.stringify(engine)}`);
  }
  if (!ENGINE_OSES.has(os)) {
    throw new InvalidArgumentError(`engine-id: unknown os ${JSON.stringify(os)}`);
  }
  if (!ENGINE_ARCHES.has(arch)) {
    throw new InvalidArgumentError(`engine-id: unknown arch ${JSON.stringify(arch)}`);
  }
  if (!/^[0-9]+(\.[0-9]+)*$/.test(upstream)) {
    throw new InvalidArgumentError(
      `engine-id: upstream must be a dotted numeric version (got ${JSON.stringify(upstream)})`,
    );
  }
  // Ids become URLs, store paths, and baked files — api/rev must be plain tokens
  // (alphanumeric-bounded, dots/underscores inside), never separators or escapes.
  const token = /^[A-Za-z0-9](?:[A-Za-z0-9._]*[A-Za-z0-9])?$/;
  if (!token.test(api) || !token.test(rev)) {
    throw new InvalidArgumentError(
      `engine-id: api and rev must be plain tokens (got ${JSON.stringify(api)}, ${JSON.stringify(rev)})`,
    );
  }
  return {
    engine: engine as EngineFamily,
    api,
    upstream,
    rev,
    os: os as EngineOs,
    arch: arch as Arch,
  };
};

/** Numeric order of a build revision's trailing counter (`bunmaska10` -> 10), or NaN. */
const revOrder = (rev: string): number => {
  const match = rev.match(/(\d+)$/);
  return match ? Number(match[1]) : Number.NaN;
};

/**
 * Compare two engine-ids for a deterministic ascending sort: by upstream version
 * (SemVer-aware), tie-broken by build-revision counter then the raw id string.
 */
export const compareEngineIds = (a: string, b: string): -1 | 0 | 1 => {
  const ra = parseEngineId(a);
  const rb = parseEngineId(b);
  const byUpstream = compareVersions(ra.upstream, rb.upstream);
  if (byUpstream !== 0) {
    return byUpstream;
  }
  const na = revOrder(ra.rev);
  const nb = revOrder(rb.rev);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) {
    return na < nb ? -1 : 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};
