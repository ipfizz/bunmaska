import { describe, expect, test } from 'bun:test';
import {
  classifyChange,
  DEV_DEFAULT_ENTRY,
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

/** A controllable test harness over the supervisor's seams. */
const makeHarness = (): {
  deps: DevDeps;
  spawns: string[];
  kills: number;
  reloads: number;
  watcherClosed: () => boolean;
  fireChange: (relPath: string) => void;
  runTimer: () => Promise<void>;
  pendingTimers: () => number;
} => {
  const spawns: string[] = [];
  let kills = 0;
  let reloads = 0;
  let closed = false;
  let onChange: ((relPath: string) => void) | undefined;
  let timerFn: (() => void) | undefined;
  const deps: DevDeps = {
    debounceMs: 100,
    spawn: (entry) => {
      spawns.push(entry);
      return {
        kill: () => {
          kills += 1;
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
    log: () => undefined,
  };
  return {
    deps,
    spawns,
    get kills() {
      return kills;
    },
    get reloads() {
      return reloads;
    },
    watcherClosed: () => closed,
    fireChange: (relPath) => onChange?.(relPath),
    runTimer: async () => {
      timerFn?.();
      // A restart awaits the old child's `exited`; yield so it can finish.
      await new Promise((r) => setTimeout(r, 0));
    },
    pendingTimers: () => (timerFn === undefined ? 0 : 1),
  };
};

describe('DevSupervisor', () => {
  test('spawns the entry on construction', () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    expect(h.spawns).toEqual(['src/main.ts']);
  });

  test('a TypeScript change restarts the child after the debounce fires', async () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/main.ts');
    expect(h.spawns).toHaveLength(1); // not yet — debounced
    await h.runTimer();
    expect(h.spawns).toEqual(['src/main.ts', 'src/main.ts']);
    expect(sup.starts).toBe(2);
    expect(sup.reloads).toBe(0);
  });

  test('a renderer asset change live-reloads instead of restarting', async () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/index.html');
    await h.runTimer();
    expect(h.spawns).toHaveLength(1); // no respawn — the window stays open
    expect(h.reloads).toBe(1);
    expect(sup.reloads).toBe(1);
    expect(sup.starts).toBe(1);
  });

  test('a restart supersedes a reload coalesced into the same window', async () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/index.html'); // would reload
    h.fireChange('src/main.ts'); // but a TS change wins
    await h.runTimer();
    expect(sup.starts).toBe(2);
    expect(h.reloads).toBe(0);
  });

  test('an ignored change never schedules anything', () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('node_modules/x.js');
    expect(h.pendingTimers()).toBe(0);
  });

  test('rapid changes coalesce into a single action', async () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/a.ts');
    h.fireChange('src/b.ts');
    h.fireChange('src/c.ts');
    await h.runTimer();
    expect(h.spawns).toHaveLength(2); // initial + one coalesced restart
  });

  test('stop closes the watcher, kills the child, and ignores later changes', () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    sup.stop();
    expect(h.watcherClosed()).toBe(true);
    h.fireChange('src/main.ts');
    expect(h.pendingTimers()).toBe(0);
    expect(h.spawns).toHaveLength(1);
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

describe('DevSupervisor rebuild action', () => {
  const makeRebuildHarness = () => {
    let rebuilds = 0;
    let reloads = 0;
    const spawns: string[] = [];
    let timerFn: (() => void) | undefined;
    let onChange: ((relPath: string) => void) | undefined;
    const deps: DevDeps = {
      classify: (relPath) => classifyChange(relPath, 'src/renderer'),
      rebuild: () => {
        rebuilds += 1;
      },
      spawn: (entry) => {
        spawns.push(entry);
        return {
          kill: () => undefined,
          reload: () => {
            reloads += 1;
          },
          exited: new Promise(() => undefined),
        };
      },
      watch: (_dir, cb) => {
        onChange = cb;
        return { close: () => undefined };
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
      log: () => undefined,
    };
    return {
      deps,
      spawns,
      get rebuilds() {
        return rebuilds;
      },
      get reloads() {
        return reloads;
      },
      fire: (p: string) => onChange?.(p),
      tick: async () => {
        timerFn?.();
        await new Promise((r) => setTimeout(r, 0));
      },
    };
  };

  test('a renderer change rebuilds without restarting or reloading directly', async () => {
    const h = makeRebuildHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/renderer/App.tsx');
    await h.tick();
    expect(h.rebuilds).toBe(1);
    expect(h.spawns).toHaveLength(1); // no restart
    expect(h.reloads).toBe(0); // the reload arrives later, from the output write
  });

  test('a restart coalesced with a rebuild wins', async () => {
    const h = makeRebuildHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('src/renderer/App.tsx');
    h.fire('src/main.ts');
    await h.tick();
    expect(h.rebuilds).toBe(0);
    // kill fired; respawn is parked on the never-settling exited, which is the
    // await-exit behaviour, so no second spawn yet.
    expect(h.spawns).toHaveLength(1);
  });

  test('a rebuild coalesced with a reload wins', async () => {
    const h = makeRebuildHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fire('dist/renderer/main.js');
    h.fire('src/renderer/App.tsx');
    await h.tick();
    expect(h.rebuilds).toBe(1);
    expect(h.reloads).toBe(0);
  });
});

describe('DevSupervisor child lifecycle', () => {
  /** A harness whose children expose a controllable `exited`. */
  const makeLifecycle = () => {
    const spawns: string[] = [];
    const logs: string[] = [];
    let settleLast: (() => void) | undefined;
    let timerFn: (() => void) | undefined;
    let onChange: ((relPath: string) => void) | undefined;
    let reloads = 0;
    const deps: DevDeps = {
      spawn: (entry) => {
        spawns.push(entry);
        let settle: () => void = () => undefined;
        const exited = new Promise<void>((r) => {
          settle = r;
        });
        settleLast = settle;
        return {
          exited,
          kill: () => undefined,
          reload: () => {
            reloads += 1;
          },
        };
      },
      watch: (_dir, cb) => {
        onChange = cb;
        return { close: () => undefined };
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
      logs,
      get reloads() {
        return reloads;
      },
      fire: (p: string) => onChange?.(p),
      tick: async () => {
        timerFn?.();
        await new Promise((r) => setTimeout(r, 0));
      },
      settleExit: () => settleLast?.(),
    };
  };

  test('a restart waits for the old child to exit before spawning the new one', async () => {
    const h = makeLifecycle();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    const first = h.settleExit; // the child spawned in the constructor
    h.fire('src/main.ts');
    await h.tick();
    // Killed, but its exit has not settled — spawning now would leave two live
    // apps racing for the window and the single-instance lock.
    expect(h.spawns).toHaveLength(1);
    first();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.spawns).toHaveLength(2);
  });

  test('a reload after the app quits says so instead of reporting success', async () => {
    const h = makeLifecycle();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.settleExit(); // the user quit the app
    await new Promise((r) => setTimeout(r, 0));
    h.fire('src/index.html');
    await h.tick();
    expect(h.reloads).toBe(0);
    expect(h.logs.join(' ')).toContain('not running');
  });
});

describe('DevSupervisor restart marking', () => {
  test('the first spawn is not a restart; every respawn is', async () => {
    // The respawned app reads this to show its window without stealing focus.
    const spawns: Array<{ restart: boolean }> = [];
    let timerFn: (() => void) | undefined;
    let onChange: ((p: string) => void) | undefined;
    const deps: DevDeps = {
      spawn: (_entry, opts) => {
        spawns.push({ restart: opts?.restart === true });
        return { kill: () => undefined, reload: () => undefined, exited: Promise.resolve() };
      },
      watch: (_dir, cb) => {
        onChange = cb;
        return { close: () => undefined };
      },
      timers: {
        set: (fn) => {
          timerFn = fn;
          return 1;
        },
        clear: () => undefined,
      },
      log: () => undefined,
    };
    new DevSupervisor('/proj', 'src/main.ts', deps);
    onChange?.('src/main.ts');
    timerFn?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(spawns).toEqual([{ restart: false }, { restart: true }]);
  });
});
