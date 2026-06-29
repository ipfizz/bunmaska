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
    expect(classifyChange('src/preload.js')).toBe('reload');
  });

  test('ignores dependency/VCS/build dirs and dotfiles', () => {
    expect(classifyChange('node_modules/x/index.js')).toBe('ignore');
    expect(classifyChange('.git/HEAD')).toBe('ignore');
    expect(classifyChange('dist/app.js')).toBe('ignore');
    expect(classifyChange('src/.main.ts.swp')).toBe('ignore');
    expect(classifyChange('')).toBe('ignore');
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
  runTimer: () => void;
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
    runTimer: () => timerFn?.(),
    pendingTimers: () => (timerFn === undefined ? 0 : 1),
  };
};

describe('DevSupervisor', () => {
  test('spawns the entry on construction', () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    expect(h.spawns).toEqual(['src/main.ts']);
  });

  test('a TypeScript change restarts the child after the debounce fires', () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/main.ts');
    expect(h.spawns).toHaveLength(1); // not yet — debounced
    h.runTimer();
    expect(h.spawns).toEqual(['src/main.ts', 'src/main.ts']);
    expect(sup.starts).toBe(2);
    expect(sup.reloads).toBe(0);
  });

  test('a renderer asset change live-reloads instead of restarting', () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/index.html');
    h.runTimer();
    expect(h.spawns).toHaveLength(1); // no respawn — the window stays open
    expect(h.reloads).toBe(1);
    expect(sup.reloads).toBe(1);
    expect(sup.starts).toBe(1);
  });

  test('a restart supersedes a reload coalesced into the same window', () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/index.html'); // would reload
    h.fireChange('src/main.ts'); // but a TS change wins
    h.runTimer();
    expect(sup.starts).toBe(2);
    expect(h.reloads).toBe(0);
  });

  test('an ignored change never schedules anything', () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('node_modules/x.js');
    expect(h.pendingTimers()).toBe(0);
  });

  test('rapid changes coalesce into a single action', () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/a.ts');
    h.fireChange('src/b.ts');
    h.fireChange('src/c.ts');
    h.runTimer();
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
