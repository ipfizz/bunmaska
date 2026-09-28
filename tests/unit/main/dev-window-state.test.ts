import { describe, expect, test } from 'bun:test';
import {
  onAnyArea,
  parseDevWindowState,
  serializeDevWindowState,
} from '../../../src/main/dev-window-state';

describe('parseDevWindowState', () => {
  test('round-trips serialized bounds', () => {
    const bounds = { x: 240, y: 180, width: 300, height: 228 };
    expect(parseDevWindowState(serializeDevWindowState(bounds))).toEqual(bounds);
  });

  test('rejects garbage, partial shapes, and degenerate sizes', () => {
    expect(parseDevWindowState('not json')).toBeUndefined();
    expect(parseDevWindowState('{}')).toBeUndefined();
    expect(parseDevWindowState('{"bounds":{"x":1,"y":2}}')).toBeUndefined();
    expect(parseDevWindowState('{"bounds":{"x":0,"y":0,"width":10,"height":10}}')).toBeUndefined();
    expect(
      parseDevWindowState('{"bounds":{"x":"a","y":0,"width":300,"height":200}}'),
    ).toBeUndefined();
  });
});

describe('onAnyArea', () => {
  const main = { x: 0, y: 0, width: 1440, height: 900 };

  test('keeps bounds that overlap a display', () => {
    expect(onAnyArea({ x: 1400, y: 850, width: 300, height: 200 }, [main])).toBe(true);
  });

  test('drops bounds left on a display that is gone', () => {
    expect(onAnyArea({ x: 1500, y: 100, width: 300, height: 200 }, [main])).toBe(false);
    expect(onAnyArea({ x: -400, y: 100, width: 300, height: 200 }, [main])).toBe(false);
  });
});
