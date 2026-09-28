import { describe, expect, test } from 'bun:test';
import { clipboard } from '../../../src/main/api/clipboard';
import * as macosClipboard from '../../../src/main/platform/macos/cocoa-clipboard';
import { nsString } from '../../../src/main/platform/macos/cocoa-foundation';
import {
  msgSendI64Ptr,
  msgSendPtrPtr,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import {
  cocoaNativeImageBackend,
  nsDataFromBytes,
  nsDataToBytes,
} from '../../../src/main/platform/macos/cocoa-native-image';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { currentPlatform } from '../../../src/common/platform';
import { makeTinyPng, TINY_PNG_WIDTH } from '../../fixtures/tiny-png';

// A valid 1x1 PNG; NSPasteboard stores public.png data verbatim, so it
// round-trips byte-for-byte without going through NativeImage's PNG encoder.
const PNG_1x1 = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** Put `png` on the pasteboard as TIFF only, the way some apps copy images. */
const writeTiffOnly = (png: Uint8Array): void => {
  const rt = cocoa();
  const rep = cocoaNativeImageBackend.decode(png).handle;
  const NS_BITMAP_IMAGE_FILE_TYPE_TIFF = 0n;
  const tiff = nsDataToBytes(
    msgSendI64Ptr(
      rep,
      rt.selectors.get('representationUsingType:properties:'),
      NS_BITMAP_IMAGE_FILE_TYPE_TIFF,
      0n,
    ),
  );
  const pasteboard = rt.msgSend(
    rt.classes.get('NSPasteboard'),
    rt.selectors.get('generalPasteboard'),
  );
  rt.msgSend(pasteboard, rt.selectors.get('clearContents'));
  msgSendPtrPtr(
    pasteboard,
    rt.selectors.get('setData:forType:'),
    nsDataFromBytes(tiff),
    nsString('public.tiff'),
  );
};

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

    test('readImage transcodes a TIFF-only clipboard image to PNG', () => {
      writeTiffOnly(makeTinyPng());
      const png = macosClipboard.readImage();
      expect(png[0]).toBe(0x89);
      expect(cocoaNativeImageBackend.decode(png).width).toBe(TINY_PNG_WIDTH);
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
