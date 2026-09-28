import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEV_STATE_FILE,
  editorTempDir,
  makeContentFilter,
  makeWatchHandler,
} from '../../../src/cli/dev-watch';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('makeContentFilter', () => {
  test('drops a save that did not change the bytes', () => {
    const filter = makeContentFilter(() => bytes('same'));
    expect(filter.changed('src/main.ts')).toBe(true);
    expect(filter.changed('src/main.ts')).toBe(false);
  });

  test('passes a real edit through', () => {
    const files = new Map([['src/main.ts', bytes('v1')]]);
    const filter = makeContentFilter((p) => files.get(p));
    expect(filter.changed('src/main.ts')).toBe(true);
    files.set('src/main.ts', bytes('v2'));
    expect(filter.changed('src/main.ts')).toBe(true);
  });

  test('tracks each path independently', () => {
    const filter = makeContentFilter(() => bytes('same'));
    expect(filter.changed('a.ts')).toBe(true);
    expect(filter.changed('b.ts')).toBe(true);
    expect(filter.changed('a.ts')).toBe(false);
  });

  test('always passes a vanished file through, and re-arms it', () => {
    const files = new Map([['a.ts', bytes('v1')]]);
    const filter = makeContentFilter((p) => files.get(p));
    expect(filter.changed('a.ts')).toBe(true);
    files.delete('a.ts');
    expect(filter.changed('a.ts')).toBe(true);
    files.set('a.ts', bytes('v1'));
    expect(filter.changed('a.ts')).toBe(true);
  });

  test('changedIfSeen seeds an unseen path silently and fires only on a later change', () => {
    // The rescan mode: firing on first sight would restart the app for every
    // untouched sibling of an editor temp file.
    const files = new Map([['a.ts', bytes('v1')]]);
    const filter = makeContentFilter((p) => files.get(p));
    expect(filter.changedIfSeen('a.ts')).toBe(false); // seeded, not fired
    files.set('a.ts', bytes('v2'));
    expect(filter.changedIfSeen('a.ts')).toBe(true);
    expect(filter.changedIfSeen('a.ts')).toBe(false);
  });

  test('changed and changedIfSeen share one baseline', () => {
    const files = new Map([['a.ts', bytes('v1')]]);
    const filter = makeContentFilter((p) => files.get(p));
    expect(filter.changed('a.ts')).toBe(true); // seeds via the normal path
    expect(filter.changedIfSeen('a.ts')).toBe(false); // same bytes, no fire
    files.set('a.ts', bytes('v2'));
    expect(filter.changedIfSeen('a.ts')).toBe(true);
  });
});

describe('editorTempDir', () => {
  test('recognises a dot-named temp file and returns its directory', () => {
    // BSD sed renames through .!<pid>!<name>; FSEvents can deliver ONLY this.
    expect(editorTempDir('src/renderer/.!1234!main.ts')).toBe('src/renderer');
    expect(editorTempDir('.main.ts.swp')).toBe('');
  });

  test('is not fooled by regular files or ignored trees', () => {
    expect(editorTempDir('src/main.ts')).toBeUndefined();
    expect(editorTempDir('node_modules/.cache/x')).toBeUndefined();
    expect(editorTempDir('MyApp.app/.hidden')).toBeUndefined();
    expect(editorTempDir('.idea/.workspace.xml.tmp')).toBeUndefined();
  });
});

describe('makeWatchHandler', () => {
  /** A temp project with `files` written, plus a handler over it recording what fired. */
  const project = (files: Record<string, string | Uint8Array>) => {
    const dir = mkdtempSync(join(tmpdir(), 'bunmaska-watch-'));
    const write = (rel: string, contents: string | Uint8Array): void => {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), contents);
    };
    for (const [rel, contents] of Object.entries(files)) {
      write(rel, contents);
    }
    const fired: string[] = [];
    const handle = makeWatchHandler(dir, (rel) => {
      fired.push(rel);
    });
    return { fired, handle, write, [Symbol.dispose]: () => rmSync(dir, { recursive: true }) };
  };

  test('drops a save that rewrote identical bytes', () => {
    using p = project({ 'src/main.ts': 'v1' });
    p.write('src/main.ts', 'v1');
    p.handle('src/main.ts');
    expect(p.fired).toEqual([]);
  });

  test('an atomic save seen only as its dot temp file fires the real file', () => {
    using p = project({ 'src/main.ts': 'v1', 'src/other.ts': 'x' });
    p.write('src/main.ts', 'v2');
    p.handle('src/.!4321!main.ts');
    expect(p.fired).toEqual(['src/main.ts']);
  });

  test('passes a binary edit that only changes bytes invalid as UTF-8', () => {
    using p = project({ 'assets/a.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x9a, 0x01]) });
    p.write('assets/a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x9b, 0x01]));
    p.handle('assets/a.png');
    expect(p.fired).toEqual(['assets/a.png']);
  });

  test('a backslash-separated event shares the baseline of its slash-separated seed', () => {
    // libuv reports Windows paths with backslashes; the seed walk uses slashes.
    using p = project({ 'src/main.ts': 'v1' });
    p.handle('src\\main.ts');
    expect(p.fired).toEqual([]);
  });

  test('a dev window-state write does not rescan the project root', () => {
    using p = project({ 'README.md': 'a' });
    p.write('README.md', 'b');
    p.write(DEV_STATE_FILE, '{}');
    p.handle(DEV_STATE_FILE);
    expect(p.fired).toEqual([]);
  });

  test('ignores edits inside dot directories', () => {
    using p = project({ '.idea/workspace.xml': 'a' });
    p.write('.idea/workspace.xml', 'b');
    p.handle('.idea/workspace.xml');
    expect(p.fired).toEqual([]);
  });
});
