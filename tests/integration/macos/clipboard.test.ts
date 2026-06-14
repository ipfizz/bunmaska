import { describe, expect, test } from 'bun:test';
import { clipboard } from '../../../src/main/api/clipboard';
import * as macosClipboard from '../../../src/main/platform/macos/cocoa-clipboard';
import { currentPlatform } from '../../../src/common/platform';

// A valid 1x1 PNG; NSPasteboard stores public.png data verbatim, so it
// round-trips byte-for-byte without going through NativeImage's PNG encoder.
const PNG_1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

if (currentPlatform() === 'macos') {
  describe('clipboard on macOS', () => {
    test('writeText then readText round-trips plain text', async () => {
      clipboard.writeText('bunmaska clipboard test');
      expect(await clipboard.readText()).toBe('bunmaska clipboard test');
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

    test('writeImage then readImage round-trips PNG bytes through NSPasteboard', () => {
      macosClipboard.writeImage(PNG_1x1);
      expect(macosClipboard.readImage()).toEqual(PNG_1x1);
    });

    test('availableFormats reports image/png after writing an image', () => {
      macosClipboard.writeImage(PNG_1x1);
      expect(macosClipboard.availableFormats()).toContain('image/png');
    });

    test('readImage is empty after the clipboard is cleared', () => {
      macosClipboard.writeImage(PNG_1x1);
      clipboard.clear();
      expect(macosClipboard.readImage().length).toBe(0);
    });
  });
}
