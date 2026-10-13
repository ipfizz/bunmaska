import { afterEach, describe, expect, test } from 'bun:test';
import { createCefApplication } from '../../../../../src/main/platform/cef/cef-backend';

const original = Object.getOwnPropertyDescriptor(process, 'platform');

afterEach(() => {
  if (original) {
    Object.defineProperty(process, 'platform', original);
  }
});

describe('CefApplication.start', () => {
  test('a failed start fails every later start the same way instead of passing silently', () => {
    // Constructing the backend opens nothing; start() then fails at the missing framework.
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const app = createCefApplication('/nonexistent-bunmaska-cef-engine/lib');
    let first: unknown;
    try {
      app.start();
    } catch (error) {
      first = error;
    }
    expect(first).toBeDefined();
    expect(() => app.start()).toThrow(first as Error);
  });
});
