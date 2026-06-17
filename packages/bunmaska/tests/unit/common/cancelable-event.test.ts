import { describe, expect, test } from 'bun:test';
import { makeCancelableEvent } from '../../../src/common/cancelable-event';

describe('makeCancelableEvent', () => {
  test('is not prevented by default', () => {
    expect(makeCancelableEvent().defaultPrevented).toBe(false);
  });

  test('preventDefault flips defaultPrevented', () => {
    const event = makeCancelableEvent();
    event.preventDefault();
    expect(event.defaultPrevented).toBe(true);
  });

  test('preventDefault is idempotent', () => {
    const event = makeCancelableEvent();
    event.preventDefault();
    event.preventDefault();
    expect(event.defaultPrevented).toBe(true);
  });
});
