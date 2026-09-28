import { describe, expect, test } from 'bun:test';
import { explorerSelectArgs } from '../../../../../src/main/platform/windows/windows-shell';

describe('explorerSelectArgs', () => {
  test('quotes an absolute path into one /select argument', () => {
    expect(explorerSelectArgs('C:\\Users\\ip\\My File.txt')).toBe(
      '/select,"C:\\Users\\ip\\My File.txt"',
    );
  });

  test('refuses a path that could break out of the quoted argument', () => {
    expect(explorerSelectArgs('C:\\a" /root,"C:\\evil')).toBeUndefined();
  });

  test('refuses a relative path, which explorer would resolve against its own cwd', () => {
    expect(explorerSelectArgs('notes.txt')).toBeUndefined();
  });
});
