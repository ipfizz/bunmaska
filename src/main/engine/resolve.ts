/**
 * Launch-time WebKit engine resolution: whether THIS process loads the OS WebView
 * (the default) or a pinned engine from the shared store.
 *
 * Precedence: `BUNMASKA_WEBKIT_PATH` (explicit dir) > `BUNMASKA_WEBKIT_ID` (env
 * id) > the baked `engine.id` next to the executable > the `system` sentinel.
 * A pinned id whose store dir lacks its `INSTALLATION_COMPLETE` marker degrades
 * to the system WebView with a loud warning — the app must still launch, but the
 * tested==shipped guarantee is explicitly flagged as broken.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type EngineRef, isSystemEngine, parseEngineId } from '../../common/engine-id';
import { type Arch, currentArch, currentPlatform, type Platform } from '../../common/platform';
import {
  engineDir,
  enginesPath,
  INSTALLATION_COMPLETE,
  linkApp,
  type StoreEnv,
} from '../../cli/engine-store';

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

/** Injectable seams for {@link resolveEngineWith}. */
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

/**
 * Candidate paths for the baked `engine.id`, in priority order: the explicit env
 * override, then the install layout `usr/share/<slug>/engine.id` (relative to the
 * executable at `usr/bin/<slug>`), then a flat sibling fallback.
 */
export const bakedIdCandidates = (execPath: string, env: StoreEnv): string[] => {
  const explicit = env['BUNMASKA_ENGINE_ID_FILE'];
  if (explicit !== undefined && explicit.length > 0) {
    return [explicit];
  }
  const dir = dirname(execPath);
  const sibling = join(dir, 'engine.id');
  const usrBin = basename(dir) === 'bin' && basename(dirname(dir)) === 'usr';
  return usrBin ? [join(dir, '..', 'share', basename(execPath), 'engine.id'), sibling] : [sibling];
};

/** Default reader for the baked `engine.id`: env override, else beside the executable. */
const defaultReadBakedId = (env: StoreEnv): string | null => {
  const candidates = bakedIdCandidates(process.execPath, env);
  for (const path of candidates) {
    try {
      const value = readFileSync(path, 'utf8').trim();
      if (value.length > 0) {
        return value;
      }
    } catch {
      // No baked id at this candidate — try the next.
    }
  }
  return null;
};

/** Resolve the engine decision from explicit deps. */
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
 * The process-singleton engine resolution. Cached so both Linux loaders (GTK +
 * WebKitGTK) agree on ONE engine — mixing a system GTK with a pinned WebKit (or
 * vice-versa) would double-load GTK symbols and crash.
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
  // ponytail: same test as preload-bundle's bunCliPath; share it once that is exported
  /(?:^|[\\/])bun(?:-[^\\/]*)?(?:\.exe)?$/i.test(execPath) ? main : execPath;

const prep: { done: boolean } = { done: false };

/** Injectable seams for {@link prepareEngineForLoad}'s auto-link side effect. */
export type PrepareDeps = {
  /** This app's stable identity (default: {@link appIdentity}). */
  readonly appPath?: string;
  /** Register an app→engine refcount link (default: the store's `linkApp`). */
  readonly link?: (root: string, appPath: string, engineId: string) => void;
};

/**
 * Apply a resolution before the first `dlopen`: print fallback warnings and, for a
 * STORE pin, register this app in the store's `.links` refcount so prune keeps the
 * engine. Runs once per process; later loaders' calls are no-ops.
 *
 * It exports no env: Bun's `process.env` writes never reach native `getenv` (so
 * WebKit's helper spawns never see them) yet leak into every `child_process` child.
 * ponytail: a pinned Linux engine's helper processes come from its build's compiled-in
 * PKGLIBEXECDIR; relocating them needs a from-source build (DEVELOPER_MODE or a dladdr patch).
 */
export const prepareEngineForLoad = (
  resolution: EngineResolution,
  _env: StoreEnv, // ponytail: unused; drop with the gtk/webkitgtk/soup loader call sites
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
  // Auto-link only a STORE pin (it has an id + root); an explicit-dir pin and
  // system mode have nothing to refcount.
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
