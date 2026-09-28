import { describe, expect, test } from 'bun:test';
import {
  classifyChange,
  DEV_DEFAULT_ENTRY,
  type ChangeAction,
  type DevDeps,
  DevSupervisor,
  resolveDevEntry,
} from '../../../src/cli/dev';

describe('resolveDevEntry', () => {
  test('prefers the explicit entry', () => {
    expect(resolveDevEntry({ entry: 'a.ts' }, 'b.ts')).toBe('b.ts');
  });

  test('falls back to the config entry, then the default', () => {
    expect(resolveDevEntry({ entry: 'a.ts' })).toBe('a.ts');
    expect(resolveDevEntry({})).toBe(DEV_DEFAULT_ENTRY);
  });
});

describe('classifyChange', () => {
  test('restarts on a TypeScript (main-process) change', () => {
    expect(classifyChange('src/main.ts')).toBe('restart');
    expect(classifyChange('src/window.tsx')).toBe('restart');
    expect(classifyChange('bunmaska.config.ts')).toBe('restart');
  });

  test('live-reloads on a renderer asset change', () => {
    expect(classifyChange('src/index.html')).toBe('reload');
    expect(classifyChange('src/styles.css')).toBe('reload');
  });

  test('restarts on a preload change, which a reload cannot pick up', () => {
    // The preload is bundled once in the BrowserWindow constructor, so reloading
    // re-injects the stale script.
    expect(classifyChange('src/preload.js')).toBe('restart');
    expect(classifyChange('app/preload.cjs')).toBe('restart');
  });

  test('reloads on a renderer bundle under dist', () => {
    // Ignoring dist meant a rebuilt renderer could never reach the window.
    expect(classifyChange('dist/renderer/assets/app.js')).toBe('reload');
    expect(classifyChange('dist/renderer/index.html')).toBe('reload');
  });

  test('ignores dependency/VCS dirs and dotfiles', () => {
    expect(classifyChange('node_modules/x/index.js')).toBe('ignore');
    expect(classifyChange('.git/HEAD')).toBe('ignore');
    expect(classifyChange('src/.main.ts.swp')).toBe('ignore');
    expect(classifyChange('')).toBe('ignore');
  });

  test('ignores the app bundles bunmaska build writes into the project root', () => {
    expect(classifyChange('MyApp.app/Contents/MacOS/index.html')).toBe('ignore');
    expect(classifyChange('MyApp.AppDir/usr/bin/myapp')).toBe('ignore');
    expect(classifyChange('build/x.js')).toBe('ignore');
    expect(classifyChange('out/x.js')).toBe('ignore');
  });
});

describe('classifyChange with a renderer root', () => {
  test('a source change under the renderer root rebuilds instead of restarting', () => {
    // This is the React fix: a component edit re-bundles and reloads, it no
    // longer tears the window down.
    expect(classifyChange('src/renderer/App.tsx', 'src/renderer')).toBe('rebuild');
    expect(classifyChange('src/renderer/styles.css', 'src/renderer')).toBe('rebuild');
  });

  test('a main-process source outside the renderer root still restarts', () => {
    expect(classifyChange('src/main.ts', 'src/renderer')).toBe('restart');
    expect(classifyChange('bunmaska.config.ts', 'src/renderer')).toBe('restart');
  });

  test('the renderer output under dist still plain-reloads', () => {
    expect(classifyChange('dist/renderer/main.js', 'src/renderer')).toBe('reload');
  });

  test('a preload under the renderer root still restarts', () => {
    expect(classifyChange('src/renderer/preload.js', 'src/renderer')).toBe('restart');
  });
});

type HarnessOptions = {
  readonly classify?: (relPath: string) => ChangeAction;
  readonly rebuild?: () => void | Promise<void>;
  /** Children ignore a plain kill; the test settles each exit itself. */
  readonly manualExit?: boolean;
  readonly killGraceMs?: number;
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A controllable harness over the supervisor's seams. */
const makeHarness = (opts: HarnessOptions = {}) => {
  const spawns: string[] = [];
  const restarts: boolean[] = [];
  const logs: string[] = [];
  const exits: Array<() => void> = [];
  let kills = 0;
  let forceKills = 0;
  let reloads = 0;
  let rebuilds = 0;
  let closed = false;
  let onChange: ((relPath: string) => void) | undefined;
  let timerFn: (() => void) | undefined;
  const deps: DevDeps = {
    debounceMs: 100,
    ...(opts.killGraceMs !== undefined ? { killGraceMs: opts.killGraceMs } : {}),
    ...(opts.classify !== undefined ? { classify: opts.classify } : {}),
    ...(opts.rebuild !== undefined
      ? {
          rebuild: () => {
            rebuilds += 1;
            return opts.rebuild?.();
          },
        }
      : {}),
    spawn: (entry, spawnOpts) => {
      spawns.push(entry);
      restarts.push(spawnOpts?.restart === true);
      let settle: () => void = () => undefined;
      const exited = new Promise<void>((r) => {
        settle = r;
      });
      exits.push(settle);
      return {
        exited,
        kill: (force) => {
          if (force === true) {
            forceKills += 1;
            settle();
            return;
          }
          kills += 1;
          if (opts.manualExit !== true) {
            settle();
          }
        },
        reload: () => {
          reloads += 1;
        },
      };
    },
    watch: (_dir, cb) => {
      onChange = cb;
      return {
        close: () => {
          closed = true;
        },
      };
    },
    timers: {
      set: (fn) => {
        timerFn = fn;
        return 1;
      },
      clear: () => {
        timerFn = undefined;
      },
    },
    log: (m) => {
      logs.push(m);
    },
  };
  return {
    deps,
    spawns,
    restarts,
    logs,
    get kills() {
      return kills;
    },
    get forceKills() {
      return forceKills;
    },
    get reloads() {
      return reloads;
    },
    get rebuilds() {
      return rebuilds;
    },
    watcherClosed: () => closed,
    fire: (relPath: string) => onChange?.(relPath),
    /** Fire the pending debounce, then let the resulting async work settle. */
    tick: async () => {
      timerFn?.();
      await flush();
    },
    pendingTimers: () => (timerFn === undefined ? 0 : 1),
    /** Settle the exit of the `index`-th spawned child (default: the latest). */
    settleExit: (index = exits.length - 1) => exits[index]?.(),
  };
};

const noop = (): void => undefined;

const rendererAt = (relPath: string): ChangeAction => classifyChange(relPath, 'src/renderer');

describe('DevSupervisor', () => {
  test('spawns the entry on construction', () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    expect(h.spawns).toEqual(['src/main.ts']);
  });

  test('a TypeScript change restarts the child after the debounce fires', async () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/main.ts');
    expect(h.spawns).toHaveLength(1);
    await h.tick();
    expect(h.spawns).toEqual(['src/main.ts', 'src/main.ts']);
    expect(sup.starts).toBe(2);
    expect(sup.reloads).toBe(0);
  });

  test('the first spawn is not a restart; every respawn is', async () => {
    // The respawned app reads this to show its window without stealing focus.
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/main.ts');
    await h.tick();
    expect(h.restarts).toEqual([false, true]);
  });

  test('a renderer asset change live-reloads instead of restarting', async () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/index.html');
    await h.tick();
    expect(h.spawns).toHaveLength(1);
    expect(h.reloads).toBe(1);
    expect(sup.reloads).toBe(1);
    expect(sup.starts).toBe(1);
  });

  test('a restart supersedes a reload coalesced into the same window', async () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/index.html');
    h.fire('src/main.ts');
    await h.tick();
    expect(sup.starts).toBe(2);
    expect(h.reloads).toBe(0);
  });

  test('an ignored change never schedules anything', () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('node_modules/x.js');
    expect(h.pendingTimers()).toBe(0);
  });

  test('rapid changes coalesce into a single action', async () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/a.ts');
    h.fire('src/b.ts');
    h.fire('src/c.ts');
    await h.tick();
    expect(h.spawns).toHaveLength(2);
  });

  test('stop closes the watcher, kills the child, and ignores later changes', () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    sup.stop();
    expect(h.watcherClosed()).toBe(true);
    expect(h.kills).toBe(1);
    h.fire('src/main.ts');
    expect(h.pendingTimers()).toBe(0);
    expect(h.spawns).toHaveLength(1);
  });
});

describe('DevSupervisor rebuild action', () => {
  test('a renderer change rebuilds without restarting or reloading directly', async () => {
    const h = makeHarness({ classify: rendererAt, rebuild: noop });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/renderer/App.tsx');
    await h.tick();
    expect(h.rebuilds).toBe(1);
    expect(h.spawns).toHaveLength(1);
    // The reload arrives later, from the output write.
    expect(h.reloads).toBe(0);
  });

  test('a restart coalesced with a renderer change rebuilds before spawning', async () => {
    const builds: Array<() => void> = [];
    const h = makeHarness({
      classify: rendererAt,
      rebuild: () => new Promise<void>((r) => builds.push(r)),
    });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/renderer/App.tsx');
    h.fire('src/main.ts');
    await h.tick();
    expect(h.rebuilds).toBe(1);
    // Spawning now would load the bundle built before the edit.
    expect(h.spawns).toHaveLength(1);
    builds[0]?.();
    await flush();
    expect(h.spawns).toHaveLength(2);
  });

  test('a renderer change during a restart delays the spawn until it is rebuilt', async () => {
    const builds: Array<() => void> = [];
    const h = makeHarness({
      classify: rendererAt,
      rebuild: () => new Promise<void>((r) => builds.push(r)),
    });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/main.ts');
    await h.tick();
    h.fire('src/renderer/App.tsx');
    await h.tick();
    builds[0]?.();
    await flush();
    expect(h.rebuilds).toBe(2);
    expect(h.spawns).toHaveLength(1);
    builds[1]?.();
    await flush();
    expect(h.spawns).toHaveLength(2);
  });

  test('a throwing rebuild is logged and does not wedge later rebuilds', async () => {
    const h = makeHarness({
      classify: rendererAt,
      rebuild: () => Promise.reject(new Error('bundler exploded')),
    });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/renderer/App.tsx');
    await h.tick();
    h.fire('src/renderer/App.tsx');
    await h.tick();
    expect(h.rebuilds).toBe(2);
    expect(h.logs.join(' ')).toContain('bundler exploded');
  });

  test('rebuilds requested mid-build run once after it, never concurrently', async () => {
    const builds: Array<() => void> = [];
    const h = makeHarness({
      classify: rendererAt,
      rebuild: () => new Promise<void>((r) => builds.push(r)),
    });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/renderer/a.tsx');
    await h.tick();
    h.fire('src/renderer/b.tsx');
    await h.tick();
    h.fire('src/renderer/c.tsx');
    await h.tick();
    expect(h.rebuilds).toBe(1);
    builds[0]?.();
    await flush();
    expect(h.rebuilds).toBe(2);
    builds[1]?.();
    await flush();
    expect(h.rebuilds).toBe(2);
  });

  test('a rebuild coalesced with a reload wins', async () => {
    const h = makeHarness({ classify: rendererAt, rebuild: noop });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('dist/renderer/main.js');
    h.fire('src/renderer/App.tsx');
    await h.tick();
    expect(h.rebuilds).toBe(1);
    expect(h.reloads).toBe(0);
  });
});

describe('DevSupervisor child lifecycle', () => {
  test('a restart waits for the old child to exit before spawning the new one', async () => {
    const h = makeHarness({ manualExit: true });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/main.ts');
    await h.tick();
    // Killed but not yet exited: spawning now would leave two live apps racing
    // for the window and the single-instance lock.
    expect(h.spawns).toHaveLength(1);
    h.settleExit(0);
    await flush();
    expect(h.spawns).toHaveLength(2);
  });

  test('a child that ignores the kill is force-killed so restarts never wedge', async () => {
    const h = makeHarness({ manualExit: true, killGraceMs: 5 });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/main.ts');
    await h.tick();
    await Bun.sleep(30);
    expect(h.forceKills).toBe(1);
    expect(h.spawns).toHaveLength(2);
    expect(h.logs.join(' ')).toContain('force-killed');
  });

  test('a failed respawn is logged and the next edit retries it', async () => {
    const h = makeHarness();
    let failSpawn = false;
    const deps: DevDeps = {
      ...h.deps,
      spawn: (entry, opts) => {
        if (failSpawn) {
          throw new Error('spawn ENOENT');
        }
        return h.deps.spawn(entry, opts);
      },
    };
    new DevSupervisor('/proj', 'src/main.ts', deps);
    failSpawn = true;
    h.fire('src/main.ts');
    await h.tick();
    expect(h.logs.join(' ')).toContain('spawn ENOENT');
    failSpawn = false;
    h.fire('src/main.ts');
    await h.tick();
    expect(h.spawns).toHaveLength(2);
  });

  test('a reload after the app quits says so instead of reporting success', async () => {
    const h = makeHarness({ manualExit: true });
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.settleExit();
    await flush();
    h.fire('src/index.html');
    await h.tick();
    expect(h.reloads).toBe(0);
    expect(h.logs.join(' ')).toContain('not running');
  });
});
