import { describe, expect, test } from 'bun:test';
import { clipboard } from '../../../src/main/api/clipboard';
import { currentPlatform } from '../../../src/common/platform';

if (currentPlatform() === 'macos') {
  describe('clipboard on macOS', () => {
    test('writeText then readText round-trips plain text', async () => {
      clipboard.writeText('sambar clipboard test');
      expect(await clipboard.readText()).toBe('sambar clipboard test');
    });

    test('writeText replaces previous contents', async () => {
      clipboard.writeText('first');
      clipboard.writeText('second');
      expect(await clipboard.readText()).toBe('second');
    });

    test('round-trips UTF-8 content', async () => {
      clipboard.writeText('café — 日本語 — 🎉');
      expect(await clipboard.readText()).toBe('café — 日本語 — 🎉');
    });

    test('clear empties the clipboard', async () => {
      clipboard.writeText('to be cleared');
      clipboard.clear();
      expect(await clipboard.readText()).toBe('');
    });

    test('readText returns a Promise (uniform async contract)', () => {
      clipboard.writeText('promise-check');
      const result = clipboard.readText();
      expect(result).toBeInstanceOf(Promise);
    });

    test('writeHTML then readHTML round-trips markup', async () => {
      clipboard.writeHTML('<b>bold</b> &amp; <i>italic</i>');
      expect(await clipboard.readHTML()).toBe('<b>bold</b> &amp; <i>italic</i>');
    });

    test('round-trips UTF-8 HTML content', async () => {
      clipboard.writeHTML('<p>café — 日本語 — 🎉</p>');
      expect(await clipboard.readHTML()).toBe('<p>café — 日本語 — 🎉</p>');
    });
  });
}
