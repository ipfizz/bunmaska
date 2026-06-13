import { describe, expect, test } from 'bun:test';
import {
  DEV_DEFAULT_ENTRY,
  type DevDeps,
  DevSupervisor,
  resolveDevEntry,
  shouldRestart,
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

describe('shouldRestart', () => {
  test('restarts on a source change', () => {
    expect(shouldRestart('src/main.ts')).toBe(true);
    expect(shouldRestart('index.html')).toBe(true);
  });

  test('ignores dependency/VCS/build dirs and dotfiles', () => {
    expect(shouldRestart('node_modules/x/index.js')).toBe(false);
    expect(shouldRestart('.git/HEAD')).toBe(false);
    expect(shouldRestart('dist/app.js')).toBe(false);
    expect(shouldRestart('src/.main.ts.swp')).toBe(false);
    expect(shouldRestart('')).toBe(false);
  });
});

/** A controllable test harness over the supervisor's seams. */
const makeHarness = (): {
  deps: DevDeps;
  spawns: string[];
  kills: number;
  watcherClosed: () => boolean;
  fireChange: (relPath: string) => void;
  runTimer: () => void;
  pendingTimers: () => number;
} => {
  const spawns: string[] = [];
  let kills = 0;
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

  test('a relevant change restarts the child after the debounce fires', () => {
    const h = makeHarness();
    const sup = new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('src/main.ts');
    expect(h.spawns).toHaveLength(1); // not yet — debounced
    h.runTimer();
    expect(h.spawns).toEqual(['src/main.ts', 'src/main.ts']);
    expect(sup.starts).toBe(2);
  });

  test('an ignored change never schedules a restart', () => {
    const h = makeHarness();
    new DevSupervisor('/proj', 'src/main.ts', h.deps);
    h.fireChange('node_modules/x.js');
    expect(h.pendingTimers()).toBe(0);
  });

  test('rapid changes coalesce into a single restart', () => {
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
