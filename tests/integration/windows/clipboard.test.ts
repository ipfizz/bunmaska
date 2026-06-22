import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { windowsNativeImageBackend } from '../../../src/main/platform/windows/windows-native-image';
import { windowsClipboardBackend } from '../../../src/main/platform/windows/windows-clipboard';

/**
 * A tiny 2x2 PNG (red/green/blue/white) used to exercise the image clipboard
 * round-trip — small enough to inline, large enough to verify dimensions survive.
 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8Dwn4GBgYEBABwYA/9aQp0AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Windows clipboard backend against the real system clipboard. Text and HTML are
 * round-trip-testable IN-PROCESS (write then read back), so no second clipboard
 * owner is needed. Synchronous throughout (unlike GDK's async read), so there is
 * nothing to pump. Runs only on a Windows host; inert elsewhere. NOTE: these
 * tests do clobber the developer's clipboard contents, like the macOS/Linux ones.
 */
if (currentPlatform() === 'windows') {
  describe('Windows clipboard backend', () => {
    test('round-trips plain text, including non-ASCII', () => {
      const text = 'bunmaska clipboard 你好 — café';
      windowsClipboardBackend.writeText(text);
      expect(windowsClipboardBackend.readText()).toBe(text);
    });

    test('writeText then availableFormats reports text/plain', () => {
      windowsClipboardBackend.writeText('x');
      expect(windowsClipboardBackend.availableFormats()).toContain('text/plain');
    });

    test('round-trips HTML through the CF_HTML format', () => {
      windowsClipboardBackend.writeHTML('<b>bold</b> and <i>italic</i>');
      expect(windowsClipboardBackend.readHTML()).toBe('<b>bold</b> and <i>italic</i>');
      expect(windowsClipboardBackend.availableFormats()).toContain('text/html');
    });

    test('clear empties the clipboard text', () => {
      windowsClipboardBackend.writeText('to be cleared');
      windowsClipboardBackend.clear();
      expect(windowsClipboardBackend.readText()).toBe('');
    });

    test('readText is empty when no text is present (after writing HTML only)', () => {
      windowsClipboardBackend.writeHTML('<p>only html</p>');
      expect(windowsClipboardBackend.readText()).toBe('');
    });

    test('round-trips an image through CF_DIB, preserving dimensions', () => {
      windowsClipboardBackend.writeImage(new Uint8Array(TINY_PNG));
      expect(windowsClipboardBackend.availableFormats()).toContain('image/png');
      // The Windows backend reads synchronously (the union type allows a Promise).
      const png = windowsClipboardBackend.readImage() as Uint8Array;
      expect(png.length).toBeGreaterThan(0);
      // The bytes come back as a re-encoded PNG; decode to confirm it is the 2x2 image.
      const decoded = windowsNativeImageBackend.decode(png);
      expect(decoded.empty).toBe(false);
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(2);
    });

    test('readImage is empty when only text is present', () => {
      windowsClipboardBackend.writeText('no image here');
      expect(windowsClipboardBackend.readImage() as Uint8Array).toHaveLength(0);
    });
  });
}
