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
  /** Install seam (default: {@link installFromDir}). */
  readonly installDir?: (root: string, sourceDir: string) => Promise<InstallResult>;
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

const runInstall = async (source: string, deps: EngineCommandDeps): Promise<number> => {
  if (existsSync(source) && statSync(source).isDirectory()) {
    const install = deps.installDir ?? installFromDir;
    const result = await install(deps.root, source);
    deps.out(
      result.installed
        ? `installed ${result.id}`
        : `${result.id} is already installed (nothing to do)`,
    );
    return 0;
  }
  deps.err(
    `bunmaska engine install: ${JSON.stringify(source)} is not a local engine directory. ` +
      'Hosted/remote engine installs are not available yet — pass a path to a built engine dir ' +
      '(see .admin/ENGINE-STORE-PLAN.md). ',
  );
  return 1;
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

const runPrune = async (dryRun: boolean, deps: EngineCommandDeps): Promise<number> => {
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
    case 'which':
      return await runWhich(sub.target, deps);
    case 'install':
      return await runInstall(sub.source, deps);
    case 'use':
      return runUse(sub.id, sub.for, deps);
    case 'prune':
      return await runPrune(sub.dryRun, deps);
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
