import { describe, expect, test } from 'bun:test';
import {
  AdaptiveBlockingPump,
  CooperativePump,
  type Ticker,
  type TickScheduler,
} from '../../../src/main/run-loop';

const manualTicker = (): { ticker: Ticker; tick: () => void; cancelled: () => boolean } => {
  let onTick: (() => void) | undefined;
  let cancelled = false;
  const ticker: Ticker = (cb) => {
    onTick = cb;
    return () => {
      cancelled = true;
      onTick = undefined;
    };
  };
  return {
    ticker,
    tick: () => onTick?.(),
    cancelled: () => cancelled,
  };
};

describe('CooperativePump.start / stop', () => {
  test('is not running before start', () => {
    const pump = new CooperativePump(() => undefined, { ticker: manualTicker().ticker });
    expect(pump.isRunning).toBe(false);
  });

  test('is running after start', () => {
    const pump = new CooperativePump(() => undefined, { ticker: manualTicker().ticker });
    pump.start();
    expect(pump.isRunning).toBe(true);
  });

  test('is not running after stop', () => {
    const m = manualTicker();
    const pump = new CooperativePump(() => undefined, { ticker: m.ticker });
    pump.start();
    pump.stop();
    expect(pump.isRunning).toBe(false);
    expect(m.cancelled()).toBe(true);
  });

  test('start is idempotent — a second start does not schedule a second ticker', () => {
    let schedules = 0;
    const ticker: Ticker = () => {
      schedules += 1;
      return () => undefined;
    };
    const pump = new CooperativePump(() => undefined, { ticker });
    pump.start();
    pump.start();
    expect(schedules).toBe(1);
  });

  test('stop is idempotent when not running', () => {
    const pump = new CooperativePump(() => undefined, { ticker: manualTicker().ticker });
    expect(() => pump.stop()).not.toThrow();
  });
});

describe('CooperativePump draining', () => {
  test('each tick invokes drainOnce', () => {
    const m = manualTicker();
    let drains = 0;
    const pump = new CooperativePump(
      () => {
        drains += 1;
      },
      { ticker: m.ticker },
    );
    pump.start();
    m.tick();
    m.tick();
    m.tick();
    expect(drains).toBe(3);
  });

  test('no draining occurs after stop', () => {
    const m = manualTicker();
    let drains = 0;
    const pump = new CooperativePump(
      () => {
        drains += 1;
      },
      { ticker: m.ticker },
    );
    pump.start();
    m.tick();
    pump.stop();
    m.tick();
    expect(drains).toBe(1);
  });

  test('a throwing drainOnce does not stop the pump (errors are swallowed per tick)', () => {
    const m = manualTicker();
    const pump = new CooperativePump(
      () => {
        throw new Error('native hiccup');
      },
      { ticker: m.ticker },
    );
    pump.start();
    expect(() => m.tick()).not.toThrow();
    expect(pump.isRunning).toBe(true);
  });
});

describe('CooperativePump interval', () => {
  test('passes the configured interval to the ticker', () => {
    let seenMs = -1;
    const ticker: Ticker = (_cb, ms) => {
      seenMs = ms;
      return () => undefined;
    };
    new CooperativePump(() => undefined, { ticker, intervalMs: 16 }).start();
    expect(seenMs).toBe(16);
  });

  test('defaults to a sensible interval when none is given', () => {
    let seenMs = -1;
    const ticker: Ticker = (_cb, ms) => {
      seenMs = ms;
      return () => undefined;
    };
    new CooperativePump(() => undefined, { ticker }).start();
    expect(seenMs).toBeGreaterThan(0);
    expect(seenMs).toBeLessThanOrEqual(32);
  });
});

const manualScheduler = (): {
  schedule: TickScheduler;
  run: () => void;
  pending: () => boolean;
} => {
  let next: (() => void) | undefined;
  return {
    schedule: (tick) => {
      next = tick;
    },
    run: () => {
      const tick = next;
      next = undefined;
      tick?.();
    },
    pending: () => next !== undefined,
  };
};

describe('AdaptiveBlockingPump start / stop', () => {
  test('is not running before start, running after', () => {
    const pump = new AdaptiveBlockingPump(() => false, { schedule: manualScheduler().schedule });
    expect(pump.isRunning).toBe(false);
    pump.start();
    expect(pump.isRunning).toBe(true);
  });

  test('start is idempotent — a second start does not drain twice', () => {
    let drains = 0;
    const pump = new AdaptiveBlockingPump(
      () => {
        drains += 1;
        return false;
      },
      { schedule: manualScheduler().schedule },
    );
    pump.start();
    pump.start();
    expect(drains).toBe(1);
  });

  test('no draining occurs after stop', () => {
    const s = manualScheduler();
    let drains = 0;
    const pump = new AdaptiveBlockingPump(
      () => {
        drains += 1;
        return false;
      },
      { schedule: s.schedule },
    );
    pump.start();
    pump.stop();
    s.run();
    expect(drains).toBe(1);
    expect(pump.isRunning).toBe(false);
  });
});

describe('AdaptiveBlockingPump adaptive timeout', () => {
  test('starts at the minimum and drives the drain with the current timeout', () => {
    const s = manualScheduler();
    const seen: number[] = [];
    const pump = new AdaptiveBlockingPump(
      (ms) => {
        seen.push(ms);
        return false;
      },
      { minTimeoutMs: 10, maxTimeoutMs: 40, schedule: s.schedule },
    );
    pump.start();
    s.run();
    s.run();
    expect(seen).toEqual([10, 20, 40]);
  });

  test('backs off exponentially toward the max while idle, then caps', () => {
    const s = manualScheduler();
    const pump = new AdaptiveBlockingPump(() => false, {
      minTimeoutMs: 8,
      maxTimeoutMs: 64,
      schedule: s.schedule,
    });
    pump.start();
    expect(pump.timeoutMs).toBe(16);
    s.run();
    expect(pump.timeoutMs).toBe(32);
    s.run();
    expect(pump.timeoutMs).toBe(64);
    s.run();
    expect(pump.timeoutMs).toBe(64);
  });

  test('snaps back to the minimum when a tick handles events', () => {
    const s = manualScheduler();
    let active = false;
    const pump = new AdaptiveBlockingPump(() => active, {
      minTimeoutMs: 8,
      maxTimeoutMs: 64,
      schedule: s.schedule,
    });
    pump.start();
    s.run();
    expect(pump.timeoutMs).toBeGreaterThan(8);
    active = true;
    s.run();
    expect(pump.timeoutMs).toBe(8);
  });

  test('a throwing drain does not stop the pump and still reschedules', () => {
    const s = manualScheduler();
    const pump = new AdaptiveBlockingPump(
      () => {
        throw new Error('native hiccup');
      },
      { schedule: s.schedule },
    );
    pump.start();
    expect(pump.isRunning).toBe(true);
    expect(s.pending()).toBe(true);
  });
});
