import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../src/common/errors';
import {
  compareEngineIds,
  type EngineRef,
  formatEngineId,
  isSystemEngine,
  parseEngineId,
  SYSTEM_ENGINE,
} from '../../../src/common/engine-id';

const ref: EngineRef = {
  engine: 'webkitgtk',
  api: '6.0',
  upstream: '2.52.4',
  rev: 'bunmaska1',
  os: 'linux',
  arch: 'x64',
};

describe('formatEngineId', () => {
  test('joins the six fields with dashes', () => {
    expect(formatEngineId(ref)).toBe('webkitgtk-6.0-2.52.4-bunmaska1-linux-x64');
  });

  test('rejects a field containing a dash (would break round-trip)', () => {
    expect(() => formatEngineId({ ...ref, rev: 'bun-maska1' })).toThrow(BunmaskaError);
    expect(() => formatEngineId({ ...ref, upstream: '2.52-4' })).toThrow(BunmaskaError);
  });
});

describe('parseEngineId', () => {
  test('round-trips a formatted id', () => {
    expect(parseEngineId(formatEngineId(ref))).toEqual(ref);
  });

  test('reads each field back in order', () => {
    const parsed = parseEngineId('webkitgtk-6.0-2.46.0-bunmaska2-linux-arm64');
    expect(parsed).toEqual({
      engine: 'webkitgtk',
      api: '6.0',
      upstream: '2.46.0',
      rev: 'bunmaska2',
      os: 'linux',
      arch: 'arm64',
    });
  });

  test('accepts the reserved windows/webview2 namespace', () => {
    const parsed = parseEngineId('webview2-fixed-126.0.2592-bunmaska1-windows-x64');
    expect(parsed.engine).toBe('webview2');
    expect(parsed.os).toBe('windows');
  });

  test.each([
    ['too few fields', 'webkitgtk-6.0-2.52.4-linux-x64'],
    ['too many fields', 'webkitgtk-6.0-2.52.4-bunmaska1-extra-linux-x64'],
    ['unknown engine family', 'chromium-6.0-2.52.4-bunmaska1-linux-x64'],
    ['unknown os', 'webkitgtk-6.0-2.52.4-bunmaska1-freebsd-x64'],
    ['unknown arch', 'webkitgtk-6.0-2.52.4-bunmaska1-linux-riscv'],
    ['non-numeric upstream', 'webkitgtk-6.0-latest-bunmaska1-linux-x64'],
    ['empty', ''],
    ['the system sentinel is not a parseable id', SYSTEM_ENGINE],
    ['a path separator in rev', 'webkitgtk-6.0-2.52.4-bun/aska1-linux-x64'],
    ['a backslash in rev', 'webkitgtk-6.0-2.52.4-bun\\aska1-linux-x64'],
    ['dot-dot traversal in api', 'webkitgtk-..-2.52.4-bunmaska1-linux-x64'],
    ['a percent escape in rev', 'webkitgtk-6.0-2.52.4-bun%2faska1-linux-x64'],
    ['whitespace in rev', 'webkitgtk-6.0-2.52.4-bun aska1-linux-x64'],
  ])('rejects %s', (_label, id) => {
    expect(() => parseEngineId(id)).toThrow(BunmaskaError);
  });
});

describe('isSystemEngine', () => {
  test('true for the sentinel and case-insensitively', () => {
    expect(isSystemEngine(SYSTEM_ENGINE)).toBe(true);
    expect(isSystemEngine('System')).toBe(true);
  });

  test('false for a real engine id', () => {
    expect(isSystemEngine('webkitgtk-6.0-2.52.4-bunmaska1-linux-x64')).toBe(false);
  });
});

describe('compareEngineIds', () => {
  const a = 'webkitgtk-6.0-2.46.0-bunmaska1-linux-x64';
  const b = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';

  test('orders by upstream version', () => {
    expect(compareEngineIds(a, b)).toBe(-1);
    expect(compareEngineIds(b, a)).toBe(1);
    expect(compareEngineIds(a, a)).toBe(0);
  });

  test('tie-breaks equal upstream by build revision', () => {
    const r1 = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';
    const r2 = 'webkitgtk-6.0-2.52.4-bunmaska2-linux-x64';
    expect(compareEngineIds(r1, r2)).toBe(-1);
  });

  test('sorts a list ascending', () => {
    const sorted = [b, a].sort(compareEngineIds);
    expect(sorted).toEqual([a, b]);
  });
});
