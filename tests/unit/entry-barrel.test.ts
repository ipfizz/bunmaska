import { describe, expect, test } from 'bun:test';
import * as bunmaskaMain from '../../src/main';
import { IMPLEMENTED_MODULES } from '../../src/main/module-list';
import * as bunmaska from '../../src';

/**
 * The barrels are the drop-in-Electron promise, so this file guards the two things
 * tsc cannot: that importing them actually works (src/main/index.ts opens with
 * `import './bootstrap'`, so a cycle or a throwing side effect fails at import time,
 * before any assertion runs), and that what `IMPLEMENTED_MODULES` claims is really
 * there — src/electron.ts throws for a KNOWN module that is not implemented, so a
 * module claimed-but-not-exported silently degrades to `electron.foo === undefined`.
 */

const mainExports = new Set(Object.keys(bunmaskaMain));
const rootExports = new Set(Object.keys(bunmaska));

describe('entry barrels', () => {
  test('both entry points import cleanly and expose the same surface', () => {
    expect(mainExports.size).toBeGreaterThan(0);
    expect([...rootExports].sort()).toEqual([...mainExports].sort());
  });

  test("the root barrel's `export *` keeps the live bindings identical", () => {
    expect(bunmaska.app).toBe(bunmaskaMain.app);
    expect(bunmaska.App).toBe(bunmaskaMain.App);
    expect(bunmaska.BunmaskaError).toBe(bunmaskaMain.BunmaskaError);
  });

  test.each([...IMPLEMENTED_MODULES])('IMPLEMENTED_MODULES claim is exported: %s', (name) => {
    expect(mainExports.has(name)).toBe(true);
    expect(rootExports.has(name)).toBe(true);
    expect((bunmaskaMain as Record<string, unknown>)[name]).toBeDefined();
  });
});
