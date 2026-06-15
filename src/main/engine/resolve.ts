/**
 * Launch-time WebKit engine resolution — the runtime half of "tested ==
 * shipped". Decides, for THIS process, whether to load the OS WebView (the
 * default) or a pinned engine from the shared store, by reading the engine-id
 * the app was built against. Pure decision logic over injected seams (env, fs,
 * the baked-id reader) so it unit-tests on any host; the actual `dlopen` of the
 * resolved path happens in the Linux loaders.
 *
 * Precedence: `BUNMASKA_WEBKIT_PATH` (explicit dir) > `BUNMASKA_WEBKIT_ID` (env
 * id) > the baked `engine.id` next to the executable > the `system` sentinel.
 * A pinned id whose store dir lacks its `INSTALLATION_COMPLETE` marker degrades
 * to the system WebView with a loud warning — the app must still launch, but the
 * tested==shipped guarantee is explicitly flagged as broken.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isSystemEngine, parseEngineId } from '../../common/engine-id';
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
};

/**
 * Candidate paths for the baked `engine.id`, in priority order: the explicit env
 * override, then the install layout `usr/share/<slug>/engine.id` (relative to the
 * executable at `usr/bin/<slug>`), then a flat sibling fallback. Pure + testable.
 */
export const bakedIdCandidates = (execPath: string, env: StoreEnv): string[] => {
  const explicit = env['BUNMASKA_ENGINE_ID_FILE'];
  if (explicit !== undefined && explicit.length > 0) {
    return [explicit];
  }
  const dir = dirname(execPath); // .../usr/bin
  const slug = basename(execPath);
  return [join(dir, '..', 'share', slug, 'engine.id'), join(dir, 'engine.id')];
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

/** Resolve the engine decision from explicit deps. Pure (no ambient globals besides defaults). */
export const resolveEngineWith = (deps: ResolveDeps = {}): EngineResolution => {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;

  const explicitDir = env['BUNMASKA_WEBKIT_PATH'];
  if (explicitDir !== undefined && explicitDir.length > 0) {
    return { mode: 'pinned', libDir: explicitDir, warnings: [] };
  }

  const readBakedId = deps.readBakedId ?? (() => defaultReadBakedId(env));
  const id = (env['BUNMASKA_WEBKIT_ID'] ?? readBakedId() ?? 'system').trim();

  if (isSystemEngine(id)) {
    return { mode: 'system', warnings: [] };
  }

  try {
    parseEngineId(id); // validate shape; the parsed fields are not needed here
  } catch {
    return {
      mode: 'system',
      warnings: [
        `bunmaska: pinned engine id ${JSON.stringify(id)} is malformed — using the system WebKit.`,
      ],
    };
  }

  const root = deps.enginesRoot ?? enginesPath(env);
  const dir = engineDir(root, id);
  if (!exists(join(dir, INSTALLATION_COMPLETE))) {
    return {
      mode: 'system',
      warnings: [
        `bunmaska: pinned engine ${id} is not installed — falling back to the system WebKit; ` +
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

/**
 * The path to pass `dlopen` for one library given a resolution: an absolute path
 * into the pinned engine's `lib/`, or the bare soname for the system loader path.
 */
export const engineLibPath = (resolution: EngineResolution, soname: string): string =>
  resolution.mode === 'pinned' && resolution.libDir !== undefined
    ? join(resolution.libDir, soname)
    : soname;

/**
 * The environment overrides needed for a pinned engine: prepend its `lib/` to
 * `LD_LIBRARY_PATH` so its bundled GTK/libsoup/ICU/GStreamer win over the
 * distro's, point `GIO_EXTRA_MODULES` at its gio modules, and point
 * `WEBKIT_EXEC_PATH` at its `libexec/` so WebKit spawns the engine's OWN helper
 * processes (WebKitNetworkProcess/WebProcess/GPUProcess) rather than the system's.
 * Empty in system mode.
 */
export const engineEnv = (
  resolution: EngineResolution,
  env: StoreEnv,
): { LD_LIBRARY_PATH?: string; GIO_EXTRA_MODULES?: string; WEBKIT_EXEC_PATH?: string } => {
  if (resolution.mode !== 'pinned' || resolution.libDir === undefined) {
    return {};
  }
  const prior = env['LD_LIBRARY_PATH'];
  return {
    LD_LIBRARY_PATH:
      prior !== undefined && prior.length > 0 ? `${resolution.libDir}:${prior}` : resolution.libDir,
    GIO_EXTRA_MODULES: join(resolution.libDir, 'gio', 'modules'),
    WEBKIT_EXEC_PATH: join(resolution.libDir, '..', 'libexec'),
  };
};

const prep: { done: boolean } = { done: false };

/** Injectable seams for {@link prepareEngineForLoad}'s auto-link side effect. */
export type PrepareDeps = {
  /** This installed app's stable identity (default: `process.execPath`). */
  readonly appPath?: string;
  /** Register an app→engine refcount link (default: the store's `linkApp`). */
  readonly link?: (root: string, appPath: string, engineId: string) => void;
};

/**
 * Apply a resolution to the process before the first `dlopen`: print any
 * fallback warnings, export `LD_LIBRARY_PATH` / `GIO_EXTRA_MODULES` for a pinned
 * engine's bundled deps, and — for a STORE pin — register this app in the store's
 * refcount (`.links`) so GC/prune know the engine is needed. Runs once per
 * process: both Linux loaders call it, only the first takes effect, keeping them
 * on a single shared engine. The link write is best-effort (a read-only store
 * must not stop the app from launching).
 */
export const prepareEngineForLoad = (
  resolution: EngineResolution,
  target: StoreEnv,
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
  const env = engineEnv(resolution, target);
  if (env.LD_LIBRARY_PATH !== undefined) {
    target['LD_LIBRARY_PATH'] = env.LD_LIBRARY_PATH;
  }
  if (env.GIO_EXTRA_MODULES !== undefined) {
    target['GIO_EXTRA_MODULES'] = env.GIO_EXTRA_MODULES;
  }
  if (env.WEBKIT_EXEC_PATH !== undefined) {
    target['WEBKIT_EXEC_PATH'] = env.WEBKIT_EXEC_PATH;
  }
  // Auto-link only a STORE pin (it has an id + root); an explicit-dir pin and
  // system mode have nothing to refcount.
  if (
    resolution.mode === 'pinned' &&
    resolution.id !== undefined &&
    resolution.root !== undefined
  ) {
    const appPath = deps.appPath ?? process.execPath;
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
