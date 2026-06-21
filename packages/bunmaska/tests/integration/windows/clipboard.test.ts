import { describe, expect, test } from 'bun:test';
import { UnsupportedPlatformError } from '../../../src/common/errors';
import { currentPlatform } from '../../../src/common/platform';
import { windowsClipboardBackend } from '../../../src/main/platform/windows/windows-clipboard';

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

    test('image read/write throw rather than silently no-op (documented gap)', () => {
      expect(() => windowsClipboardBackend.readImage()).toThrow(UnsupportedPlatformError);
      expect(() => windowsClipboardBackend.writeImage(new Uint8Array([1]))).toThrow(
        UnsupportedPlatformError,
      );
    });
  });
}
