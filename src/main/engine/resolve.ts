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
import { dirname, join } from 'node:path';
import { isSystemEngine, parseEngineId } from '../../common/engine-id';
import {
  engineDir,
  enginesPath,
  INSTALLATION_COMPLETE,
  type StoreEnv,
} from '../../cli/engine-store';

/** The resolved engine decision for the current process. */
export type EngineResolution = {
  readonly mode: 'system' | 'pinned';
  /** The pinned engine's `lib/` dir (absolute). Absent in system mode. */
  readonly libDir?: string;
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

/** Default reader for the baked `engine.id`: env override, else beside the executable. */
const defaultReadBakedId = (env: StoreEnv): string | null => {
  const explicit = env['BUNMASKA_ENGINE_ID_FILE'];
  const candidates = explicit ? [explicit] : [join(dirname(process.execPath), 'engine.id')];
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
  return { mode: 'pinned', libDir: join(dir, 'lib'), warnings: [] };
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
 * distro's, and point `GIO_EXTRA_MODULES` at its gio modules. Empty in system mode.
 */
export const engineEnv = (
  resolution: EngineResolution,
  env: StoreEnv,
): { LD_LIBRARY_PATH?: string; GIO_EXTRA_MODULES?: string } => {
  if (resolution.mode !== 'pinned' || resolution.libDir === undefined) {
    return {};
  }
  const prior = env['LD_LIBRARY_PATH'];
  return {
    LD_LIBRARY_PATH:
      prior !== undefined && prior.length > 0 ? `${resolution.libDir}:${prior}` : resolution.libDir,
    GIO_EXTRA_MODULES: join(resolution.libDir, 'gio', 'modules'),
  };
};
