import { describe, expect, test } from 'bun:test';
import { editorTempDir, makeContentFilter } from '../../../src/cli/dev-watch';

describe('makeContentFilter', () => {
  test('drops a save that did not change the bytes', () => {
    const filter = makeContentFilter(() => 'same');
    expect(filter.changed('src/main.ts')).toBe(true);
    expect(filter.changed('src/main.ts')).toBe(false);
  });

  test('passes a real edit through', () => {
    const files = new Map([['src/main.ts', 'v1']]);
    const filter = makeContentFilter((p) => files.get(p));
    expect(filter.changed('src/main.ts')).toBe(true);
    files.set('src/main.ts', 'v2');
    expect(filter.changed('src/main.ts')).toBe(true);
  });

  test('tracks each path independently', () => {
    const filter = makeContentFilter(() => 'same');
    expect(filter.changed('a.ts')).toBe(true);
    expect(filter.changed('b.ts')).toBe(true);
    expect(filter.changed('a.ts')).toBe(false);
  });

  test('always passes a vanished file through, and re-arms it', () => {
    const files = new Map([['a.ts', 'v1']]);
    const filter = makeContentFilter((p) => files.get(p));
    expect(filter.changed('a.ts')).toBe(true);
    files.delete('a.ts');
    expect(filter.changed('a.ts')).toBe(true);
    files.set('a.ts', 'v1');
    expect(filter.changed('a.ts')).toBe(true);
  });

  test('changedIfSeen seeds an unseen path silently and fires only on a later change', () => {
    // The rescan mode: firing on first sight would restart the app for every
    // untouched sibling of an editor temp file.
    const files = new Map([['a.ts', 'v1']]);
    const filter = makeContentFilter((p) => files.get(p));
    expect(filter.changedIfSeen('a.ts')).toBe(false); // seeded, not fired
    files.set('a.ts', 'v2');
    expect(filter.changedIfSeen('a.ts')).toBe(true);
    expect(filter.changedIfSeen('a.ts')).toBe(false);
  });

  test('changed and changedIfSeen share one baseline', () => {
    const files = new Map([['a.ts', 'v1']]);
    const filter = makeContentFilter((p) => files.get(p));
    expect(filter.changed('a.ts')).toBe(true); // seeds via the normal path
    expect(filter.changedIfSeen('a.ts')).toBe(false); // same bytes, no fire
    files.set('a.ts', 'v2');
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
