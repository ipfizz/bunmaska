// Launch-time engine choice: the OS WebView (default) or a pinned engine from the store.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type EngineRef, isSystemEngine, parseEngineId } from '../../common/engine-id';
import { isBunCli } from '../../common/preload-bundle';
import { type Arch, currentArch, currentPlatform, type Platform } from '../../common/platform';
import {
  engineDir,
  enginesPath,
  INSTALLATION_COMPLETE,
  linkApp,
  type StoreEnv,
} from '../../common/engine-store';

/** The resolved engine decision for the current process. */
export type EngineResolution = {
  readonly mode: 'system' | 'pinned';
  /** The pinned engine's `lib/` dir (absolute). Absent in system mode. */
  readonly libDir?: string;
  /** The resolved engine-id (store pins only; absent for an explicit-dir pin/system). */
  readonly id?: string;
  /** The store root the id was resolved against (store pins only). */
  readonly root?: string;
  /** Non-fatal warnings to surface on stderr (e.g. a broken pin fell back). */
  readonly warnings: readonly string[];
};

export type ResolveDeps = {
  readonly env?: StoreEnv;
  /** Existence check for the marker (default: real fs). */
  readonly exists?: (path: string) => boolean;
  /** Read the engine-id baked into the bundle, or null if none. */
  readonly readBakedId?: () => string | null;
  /** Override the store root (default: {@link enginesPath} of `env`). */
  readonly enginesRoot?: string;
  /** The machine the engine must be built for (default: this one). */
  readonly host?: { readonly os: Platform; readonly arch: Arch };
};

/** Where the baked `engine.id` may live, highest priority first. */
export const bakedIdCandidates = (execPath: string, env: StoreEnv): string[] => {
  const explicit = env['BUNMASKA_ENGINE_ID_FILE'];
  if (explicit !== undefined && explicit.length > 0) {
    return [explicit];
  }
  return [join(dirname(execPath), 'engine.id')];
};

const defaultReadBakedId = (env: StoreEnv): string | null => {
  const candidates = bakedIdCandidates(process.execPath, env);
  for (const path of candidates) {
    try {
      const value = readFileSync(path, 'utf8').trim();
      if (value.length > 0) {
        return value;
      }
    } catch {
      // Absent here; try the next candidate.
    }
  }
  return null;
};

/** The engine to load; a bad or foreign pin degrades to `system` with a warning, never a throw. */
export const resolveEngineWith = (deps: ResolveDeps = {}): EngineResolution => {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;

  const explicitDir = env['BUNMASKA_WEBKIT_PATH'];
  if (explicitDir !== undefined && explicitDir.length > 0) {
    return { mode: 'pinned', libDir: explicitDir, warnings: [] };
  }

  const readBakedId = deps.readBakedId ?? (() => defaultReadBakedId(env));
  const id = env['BUNMASKA_WEBKIT_ID']?.trim() || readBakedId()?.trim() || 'system';

  if (isSystemEngine(id)) {
    return { mode: 'system', warnings: [] };
  }

  let ref: EngineRef;
  try {
    ref = parseEngineId(id);
  } catch {
    return {
      mode: 'system',
      warnings: [
        `bunmaska: pinned engine id ${JSON.stringify(id)} is malformed, so it is not used.`,
      ],
    };
  }

  const host = deps.host ?? { os: currentPlatform(), arch: currentArch() };
  if (ref.os !== host.os || ref.arch !== host.arch) {
    return {
      mode: 'system',
      warnings: [
        `bunmaska: pinned engine ${id} is built for ${ref.os}-${ref.arch}, not this ` +
          `${host.os}-${host.arch} machine, so it is not used.`,
      ],
    };
  }

  const root = deps.enginesRoot ?? enginesPath(env);
  const dir = engineDir(root, id);
  if (!exists(join(dir, INSTALLATION_COMPLETE))) {
    return {
      mode: 'system',
      warnings: [
        `bunmaska: pinned engine ${id} is not installed, so it is not used and ` +
          `tested==shipped is not guaranteed. Run \`bunmaska engine install ${id}\` to restore it.`,
      ],
    };
  }
  return { mode: 'pinned', libDir: join(dir, 'lib'), id, root, warnings: [] };
};

const cache: { value: EngineResolution | undefined } = { value: undefined };

/**
 * The memoized resolution. Every Linux loader of an engine-closure library must dlopen
 * through `engineLibPath(resolveEngine(), ...)`: a system GTK or glib beside a pinned
 * WebKitGTK double-loads their symbols and crashes.
 */
export const resolveEngine = (): EngineResolution => {
  if (cache.value === undefined) {
    cache.value = resolveEngineWith();
  }
  return cache.value;
};

/** Reset the cached resolution (test seam only). */
export const resetEngineResolution = (): void => {
  cache.value = undefined;
};

/** The `dlopen` path for a library: absolute into a pinned `lib/`, else the bare soname. */
export const engineLibPath = (resolution: EngineResolution, soname: string): string =>
  resolution.mode === 'pinned' && resolution.libDir !== undefined
    ? join(resolution.libDir, soname)
    : soname;

/** The path prune checks for this app: the entry script under the Bun CLI, else the executable. */
export const appIdentity = (execPath: string, main: string): string =>
  isBunCli(execPath) ? main : execPath;

const prep: { done: boolean } = { done: false };

export type PrepareDeps = {
  /** This app's stable identity (default: {@link appIdentity}). */
  readonly appPath?: string;
  /** Default: the store's `linkApp`. */
  readonly link?: (root: string, appPath: string, engineId: string) => void;
};

/**
 * Once per process, before the first `dlopen`: print the warnings and link a store pin
 * so prune keeps its engine. Never set env here: Bun's `process.env` writes never reach
 * native `getenv` (WebKit's helper spawns miss them) but leak into `child_process` children.
 * ponytail: pinned Linux helpers run from the build's PKGLIBEXECDIR; needs a from-source engine
 */
export const prepareEngineForLoad = (
  resolution: EngineResolution,
  write: (text: string) => void,
  deps: PrepareDeps = {},
): void => {
  if (prep.done) {
    return;
  }
  prep.done = true;
  for (const warning of resolution.warnings) {
    write(`${warning}\n`);
  }
  if (
    resolution.mode === 'pinned' &&
    resolution.id !== undefined &&
    resolution.root !== undefined
  ) {
    const appPath = deps.appPath ?? appIdentity(process.execPath, Bun.main);
    const link = deps.link ?? linkApp;
    try {
      link(resolution.root, appPath, resolution.id);
    } catch {
      // Best-effort: a read-only/locked store must not block launch.
    }
  }
};

/** Reset the one-shot preparation guard (test seam only). */
export const resetEnginePreparation = (): void => {
  prep.done = false;
};
