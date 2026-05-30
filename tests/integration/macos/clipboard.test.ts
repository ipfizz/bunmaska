import { describe, expect, test } from 'bun:test';
import { clipboard } from '../../../src/main/api/clipboard';
import { currentPlatform } from '../../../src/common/platform';

if (currentPlatform() === 'macos') {
  describe('clipboard on macOS', () => {
    test('writeText then readText round-trips plain text', () => {
      clipboard.writeText('sambar clipboard test');
      expect(clipboard.readText()).toBe('sambar clipboard test');
    });

    test('writeText replaces previous contents', () => {
      clipboard.writeText('first');
      clipboard.writeText('second');
      expect(clipboard.readText()).toBe('second');
    });

    test('round-trips UTF-8 content', () => {
      clipboard.writeText('café — 日本語 — 🎉');
      expect(clipboard.readText()).toBe('café — 日本語 — 🎉');
    });

    test('clear empties the clipboard', () => {
      clipboard.writeText('to be cleared');
      clipboard.clear();
      expect(clipboard.readText()).toBe('');
    });
  });
}
