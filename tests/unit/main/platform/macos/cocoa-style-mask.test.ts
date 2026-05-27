import { describe, expect, test } from 'bun:test';
import {
  BORDERLESS_WINDOW_STYLE,
  computeWindowStyleMask,
  STANDARD_WINDOW_STYLE,
} from '../../../../../src/main/platform/macos/cocoa-style-mask';

describe('computeWindowStyleMask', () => {
  test('borderless (empty object) is 0', () => {
    expect(computeWindowStyleMask({})).toBe(0);
  });

  test('titled-only is bit 0 (1)', () => {
    expect(computeWindowStyleMask({ titled: true })).toBe(1 << 0);
  });

  test('closable-only is bit 1 (2)', () => {
    expect(computeWindowStyleMask({ closable: true })).toBe(1 << 1);
  });

  test('miniaturizable-only is bit 2 (4)', () => {
    expect(computeWindowStyleMask({ miniaturizable: true })).toBe(1 << 2);
  });

  test('resizable-only is bit 3 (8)', () => {
    expect(computeWindowStyleMask({ resizable: true })).toBe(1 << 3);
  });

  test('utility-only is bit 4 (16)', () => {
    expect(computeWindowStyleMask({ utility: true })).toBe(1 << 4);
  });

  test('fullSizeContentView-only is bit 15 (32768)', () => {
    expect(computeWindowStyleMask({ fullSizeContentView: true })).toBe(1 << 15);
  });

  test('combines independent flags via bitwise OR', () => {
    const mask = computeWindowStyleMask({
      titled: true,
      closable: true,
      resizable: true,
    });
    expect(mask).toBe((1 << 0) | (1 << 1) | (1 << 3));
  });

  test('false flags do not contribute bits', () => {
    expect(computeWindowStyleMask({ titled: true, resizable: false })).toBe(1 << 0);
  });

  test('same input always produces same output', () => {
    const input = { titled: true, closable: true };
    expect(computeWindowStyleMask(input)).toBe(computeWindowStyleMask(input));
  });
});

describe('STANDARD_WINDOW_STYLE', () => {
  test('has the four standard flags enabled', () => {
    expect(STANDARD_WINDOW_STYLE.titled).toBe(true);
    expect(STANDARD_WINDOW_STYLE.closable).toBe(true);
    expect(STANDARD_WINDOW_STYLE.miniaturizable).toBe(true);
    expect(STANDARD_WINDOW_STYLE.resizable).toBe(true);
  });

  test('composes to mask 15 (titled|closable|mini|resizable)', () => {
    expect(computeWindowStyleMask(STANDARD_WINDOW_STYLE)).toBe(
      (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3),
    );
  });
});

describe('BORDERLESS_WINDOW_STYLE', () => {
  test('composes to mask 0', () => {
    expect(computeWindowStyleMask(BORDERLESS_WINDOW_STYLE)).toBe(0);
  });
});
