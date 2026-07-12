/**
 * The `bunmaska engine …` and `bunmaska doctor` command implementations.
 *
 * Kept out of the CLI entry (`index.ts`) and built on injected seams (store
 * root, output sinks, a config reader) so every branch is unit-testable on any
 * host without touching the real `~/.bunmaska` store or a project on disk.
 */

import { existsSync, statSync } from 'node:fs';
import { compareEngineIds, isSystemEngine, parseEngineId } from '../common/engine-id';
import type { BunmaskaConfig } from '../common/config-schema';
import { currentArch, currentPlatform } from '../common/platform';
import type { EngineSubcommand } from './parse-args';
import { type EngineIndexEntry, fetchEngineIndex } from './engine-index';
import {
  DEFAULT_ENGINE_FEED_URL,
  defaultRemoteFetch,
  engineFeedArtifactUrl,
  installFromUrl,
} from './engine-remote';
import { resolveEnginePublicKey } from './engine-signature';
import {
  gc,
  type InstallResult,
  installFromDir,
  isInstalled,
  listInstalled,
  readLinks,
  type StoreEnv,
  verifyEngine,
} from './engine-store';

/** Injected dependencies for the engine/doctor commands. */
export type EngineCommandDeps = {
  /** The engine store root (the `webkit/` dir). */
  readonly root: string;
  readonly env: StoreEnv;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** Read a project's validated config (empty `{}` when none). */
  readonly readConfig: (target: string) => Promise<BunmaskaConfig>;
  /** Local-dir install seam (default: {@link installFromDir}). */
  readonly installDir?: (root: string, sourceDir: string) => Promise<InstallResult>;
  /** Remote (feed) install seam (default: {@link installFromUrl} + real fetch). */
  readonly installUrl?: (root: string, url: string, publicKeyPem: string) => Promise<InstallResult>;
  /** Feed-index seam (default: {@link fetchEngineIndex} + real fetch). */
  readonly fetchIndex?: (feedBase: string) => Promise<EngineIndexEntry[]>;
};

/** Sort engine ids ascending, tolerating any non-id dir names. */
const sortIds = (ids: readonly string[]): string[] =>
  [...ids].sort((a, b) => {
    try {
      return compareEngineIds(a, b);
    } catch {
      return a < b ? -1 : a > b ? 1 : 0;
    }
  });

/** The pinned engine declared by a project's config (defaults to the system sentinel). */
const configPin = (config: BunmaskaConfig): string => config.engine?.webkit ?? 'system';

const runList = (deps: EngineCommandDeps): number => {
  const installed = listInstalled(deps.root);
  if (installed.length === 0) {
    deps.out('No engines installed — apps use the system WebKit by default.');
    return 0;
  }
  const refs = new Map<string, number>();
  for (const link of readLinks(deps.root)) {
    refs.set(link.engine, (refs.get(link.engine) ?? 0) + 1);
  }
  for (const id of sortIds(installed)) {
    const count = refs.get(id) ?? 0;
    deps.out(`${id}  (${count} app${count === 1 ? '' : 's'})`);
  }
  return 0;
};

const runAvailable = async (deps: EngineCommandDeps): Promise<number> => {
  const config = await deps.readConfig('.');
  const feed = config.engine?.feed?.url ?? undefined;
  const fetchIndex =
    deps.fetchIndex ?? ((base: string) => fetchEngineIndex(base, defaultRemoteFetch));
  let entries: EngineIndexEntry[];
  try {
    entries = await fetchIndex(feed ?? DEFAULT_ENGINE_FEED_URL);
  } catch (error) {
    deps.err(
      `bunmaska engine available: could not read the feed index: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  if (entries.length === 0) {
    deps.out('No engines are published on the feed yet.');
    return 0;
  }
  const here = `${currentPlatform()}/${currentArch()}`;
  deps.out(
    `Engines on the feed (this machine is ${here}). * = installed, > = matches this machine:`,
  );
  for (const e of [...entries].sort((a, b) => compareEngineIds(a.id, b.id))) {
    const installedMark = isInstalled(deps.root, e.id) ? '*' : ' ';
    const hereMark = e.os === currentPlatform() && e.arch === currentArch() ? '>' : ' ';
    const mb = e.size !== undefined ? `  (${(e.size / (1024 * 1024)).toFixed(0)} MB)` : '';
    deps.out(`${installedMark}${hereMark} ${e.id}${mb}`);
  }
  deps.out('Install one with: bunmaska engine install <id>');
  return 0;
};

const runWhich = async (target: string | undefined, deps: EngineCommandDeps): Promise<number> => {
  const config = await deps.readConfig(target ?? '.');
  const pin = configPin(config);
  if (isSystemEngine(pin)) {
    deps.out('system — uses the OS WebView (no pinned engine)');
    return 0;
  }
  try {
    parseEngineId(pin);
    const state = isInstalled(deps.root, pin)
      ? 'installed'
      : 'NOT installed — run `bunmaska engine install`';
    deps.out(`${pin}  [${state}]`);
  } catch {
    deps.out(`${pin}  (bare upstream — resolved to a full engine-id at build time)`);
  }
  return 0;
};

const installedMessage = (result: InstallResult): string =>
  result.installed ? `installed ${result.id}` : `${result.id} is already installed (nothing to do)`;

/** True for a bare, well-formed engine-id (not `system`, not a path, not a URL). */
const isBareEngineId = (source: string): boolean => {
  if (isSystemEngine(source)) {
    return false;
  }
  try {
    parseEngineId(source);
    return true;
  } catch {
    return false;
  }
};

const runInstall = async (source: string, deps: EngineCommandDeps): Promise<number> => {
  const isUrl = /^https?:\/\//.test(source);
  // A local, already-extracted engine directory wins over feed routing — a dir
  // whose name happens to be a valid engine-id must not be shadowed by the feed,
  // and a local install never reads (or is broken by) bunmaska.config.
  if (!isUrl && existsSync(source) && statSync(source).isDirectory()) {
    const install = deps.installDir ?? installFromDir;
    deps.out(installedMessage(await install(deps.root, source)));
    return 0;
  }
  if (!isUrl && !isBareEngineId(source)) {
    deps.err(
      `bunmaska engine install: ${JSON.stringify(source)} is neither a local engine directory, an ` +
        'engine-id, nor an http(s) feed URL. Pass a built engine dir, an engine-id, or a .tar.zst URL.',
    );
    return 1;
  }
  // A bare id already in the store needs no download.
  if (!isUrl && isInstalled(deps.root, source)) {
    deps.out(`${source} is already installed (nothing to do)`);
    return 0;
  }
  // A published feed artifact: resolve the URL (bare id -> configured/official
  // feed), verify its signature + hash, then install via the store.
  const config = await deps.readConfig('.');
  const url = isUrl ? source : engineFeedArtifactUrl(source, config.engine?.feed?.url ?? undefined);
  const publicKey = resolveEnginePublicKey({
    feedPublicKey: config.engine?.feed?.publicKey,
    env: deps.env,
  });
  if (publicKey === undefined) {
    deps.err(
      'bunmaska engine install: no signing key to verify this engine. For a self-hosted feed, ' +
        'set engine.feed.publicKey in bunmaska.config. Local engine directories install without a feed.',
    );
    return 1;
  }
  const installUrl =
    deps.installUrl ??
    ((root, u, key) => installFromUrl(root, u, key, { fetch: defaultRemoteFetch }));
  try {
    deps.out(installedMessage(await installUrl(deps.root, url, publicKey)));
    return 0;
  } catch (error) {
    deps.err(`bunmaska engine install: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
};

const runUse = (id: string, forDir: string | undefined, deps: EngineCommandDeps): number => {
  if (!isSystemEngine(id)) {
    try {
      parseEngineId(id);
    } catch (error) {
      deps.err(`bunmaska engine use: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
  const where = forDir ?? '.';
  deps.out(
    `Pin this engine per-project in ${where}/bunmaska.config.ts (there is no global switch):`,
  );
  deps.out('');
  deps.out('  export default defineConfig({');
  deps.out(`    engine: { webkit: ${JSON.stringify(id)} },`);
  deps.out('  });');
  deps.out('');
  deps.out(
    `Then \`bunmaska engine install ${id}\` (or build with an embedded engine) to fetch it.`,
  );
  return 0;
};

const runPrune = async (
  dryRun: boolean,
  force: boolean,
  deps: EngineCommandDeps,
): Promise<number> => {
  // Refcounts are populated by apps at launch. Before any app has registered,
  // every engine looks unreferenced — so a plain prune would wipe the whole
  // store. Refuse that case unless explicitly forced (or just previewing).
  const installed = listInstalled(deps.root);
  if (!dryRun && !force && installed.length > 0 && readLinks(deps.root).length === 0) {
    deps.out(
      `Refusing to prune: no app has registered a dependency yet, so all ${installed.length} ` +
        'installed engine(s) look unreferenced. Apps register on launch — re-run with --force ' +
        'to prune anyway, or --dry-run to preview.',
    );
    return 0;
  }
  const result = await gc(deps.root, { dryRun });
  if (result.removed.length === 0) {
    deps.out('Nothing to prune — every installed engine is still referenced.');
  } else {
    deps.out(
      `${dryRun ? 'Would remove' : 'Removed'} ${result.removed.length} unreferenced engine(s):`,
    );
    for (const id of result.removed) {
      deps.out(`  ${id}`);
    }
  }
  if (result.droppedLinks > 0) {
    deps.out(`Dropped ${result.droppedLinks} dead app link(s).`);
  }
  deps.out(`Kept ${result.kept.length} referenced engine(s).`);
  if (dryRun) {
    deps.out('(dry run — nothing was deleted)');
  }
  return 0;
};

const runVerify = (id: string, deps: EngineCommandDeps): number => {
  const result = verifyEngine(deps.root, id);
  if (result.ok) {
    deps.out(`${id}: ok`);
    return 0;
  }
  deps.err(`${id}: FAILED`);
  for (const problem of result.problems) {
    deps.err(`  - ${problem}`);
  }
  return 1;
};

/** Run a `bunmaska engine <sub>` command and resolve to the process exit code. */
export const runEngine = async (
  sub: EngineSubcommand,
  deps: EngineCommandDeps,
): Promise<number> => {
  switch (sub.action) {
    case 'list':
      return runList(deps);
    case 'available':
      return await runAvailable(deps);
    case 'which':
      return await runWhich(sub.target, deps);
    case 'install':
      return await runInstall(sub.source, deps);
    case 'use':
      return runUse(sub.id, sub.for, deps);
    case 'prune':
      return await runPrune(sub.dryRun, sub.force, deps);
    case 'verify':
      return runVerify(sub.id, deps);
  }
};

/**
 * `bunmaska doctor` — a Tauri-`info`-style health report: runtime, platform,
 * the engine store, and the resolved pin for a project. Exits non-zero only when
 * the project pins a full engine-id that is not installed (a real misconfig).
 */
export const runDoctor = async (
  target: string | undefined,
  deps: EngineCommandDeps,
): Promise<number> => {
  const installed = listInstalled(deps.root);
  deps.out('Bunmaska doctor');
  deps.out(`  bun:       ${Bun.version}`);
  deps.out(`  platform:  ${currentPlatform()}-${currentArch()}`);
  deps.out(`  store:     ${deps.root}`);
  deps.out(`  engines:   ${installed.length} installed`);
  deps.out(
    currentPlatform() === 'macos'
      ? '  webkit:    system WKWebView (pinning deferred on macOS)'
      : '  webkit:    WebKitGTK 6.0 (system soname libwebkitgtk-6.0.so.4)',
  );

  const config = await deps.readConfig(target ?? '.');
  const pin = configPin(config);
  if (isSystemEngine(pin)) {
    deps.out('  project:   system WebKit (no pin)');
    return 0;
  }
  let isFullId = true;
  try {
    parseEngineId(pin);
  } catch {
    isFullId = false;
  }
  if (!isFullId) {
    deps.out(`  project:   pins ${pin} (bare upstream, resolved at build time)`);
    return 0;
  }
  if (isInstalled(deps.root, pin)) {
    deps.out(`  project:   pins ${pin} [installed ✓]`);
    return 0;
  }
  deps.err(`  project:   pins ${pin} [NOT installed ✗] — run \`bunmaska engine install ${pin}\``);
  return 1;
};
