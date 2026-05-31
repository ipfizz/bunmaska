import { describe, expect, it } from 'bun:test';
import { pathToFileUri } from '../../../../../src/main/platform/linux/gtk-shell';

describe('pathToFileUri', () => {
  it('prefixes an absolute path with file:// and keeps the leading slash', () => {
    expect(pathToFileUri('/home/u/file.txt')).toBe('file:///home/u/file.txt');
  });

  it('percent-encodes spaces', () => {
    expect(pathToFileUri('/home/u/a b.txt')).toBe('file:///home/u/a%20b.txt');
  });

  it('percent-encodes other special characters while keeping path separators', () => {
    expect(pathToFileUri('/home/u/a#b?c.txt')).toBe('file:///home/u/a%23b%3Fc.txt');
  });

  it('leaves an already-safe nested path untouched', () => {
    expect(pathToFileUri('/var/log/app/out.log')).toBe('file:///var/log/app/out.log');
  });
});
