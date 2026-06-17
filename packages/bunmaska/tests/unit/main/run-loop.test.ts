import { describe, expect, test } from 'bun:test';
import { CooperativePump, type Ticker } from '../../../src/main/run-loop';

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
