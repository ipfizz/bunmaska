import { describe, expect, test } from 'bun:test';
import {
  buildCfHtml,
  buildPackedDib,
  dibBitsOffset,
  extractCfHtmlFragment,
} from '../../../../../src/main/platform/windows/windows-clipboard';

/** Construct a `BITMAPINFOHEADER` with the fields `dibBitsOffset` reads. */
const bitmapInfoHeader = (opts: {
  biSize?: number;
  biBitCount: number;
  biCompression?: number;
  biClrUsed?: number;
}): Uint8Array => {
  const header = new Uint8Array(Math.max(opts.biSize ?? 40, 40));
  const view = new DataView(header.buffer);
  view.setUint32(0, opts.biSize ?? 40, true);
  view.setUint16(14, opts.biBitCount, true);
  view.setUint32(16, opts.biCompression ?? 0, true);
  view.setUint32(32, opts.biClrUsed ?? 0, true);
  return header;
};

/**
 * Pure CF_HTML encode/decode for the Windows clipboard HTML format. The Windows
 * "HTML Format" clipboard payload is a UTF-8 document prefixed by a header whose
 * `StartHTML/EndHTML/StartFragment/EndFragment` are BYTE offsets into that
 * payload; these tests pin the offset arithmetic (the easy thing to get wrong)
 * and the round-trip through the standard `<!--StartFragment-->` markers that
 * every browser also writes, so we interoperate both ways.
 */
const byteLen = (text: string): number => new TextEncoder().encode(text).length;

/** Read a `Field:0000000123` header value back as a number. */
const headerOffset = (cfHtml: string, field: string): number => {
  const match = cfHtml.match(new RegExp(`${field}:(\\d+)`));
  if (match === null) {
    throw new Error(`missing header field ${field}`);
  }
  return Number(match[1]);
};

describe('buildCfHtml', () => {
  test('emits the required CF_HTML header fields', () => {
    const cf = buildCfHtml('<b>hi</b>');
    expect(cf.startsWith('Version:0.9')).toBe(true);
    for (const field of ['StartHTML', 'EndHTML', 'StartFragment', 'EndFragment']) {
      expect(cf).toContain(`${field}:`);
    }
    expect(cf).toContain('<!--StartFragment--><b>hi</b><!--EndFragment-->');
  });

  test('EndHTML equals the payload byte length', () => {
    const cf = buildCfHtml('<p>body</p>');
    expect(headerOffset(cf, 'EndHTML')).toBe(byteLen(cf));
  });

  test('StartFragment/EndFragment bracket exactly the markup bytes', () => {
    const markup = '<b>hi</b>';
    const cf = buildCfHtml(markup);
    expect(headerOffset(cf, 'EndFragment') - headerOffset(cf, 'StartFragment')).toBe(
      byteLen(markup),
    );
  });

  test('StartHTML points at the start of <html>', () => {
    const cf = buildCfHtml('<i>x</i>');
    expect(byteLen(cf.slice(0, headerOffset(cf, 'StartHTML')))).toBe(headerOffset(cf, 'StartHTML'));
    expect(cf.slice(headerOffset(cf, 'StartHTML')).startsWith('<html>')).toBe(true);
  });

  test('offsets stay correct with multi-byte (non-ASCII) markup', () => {
    const markup = '<p>你好 — café</p>';
    const cf = buildCfHtml(markup);
    expect(headerOffset(cf, 'EndHTML')).toBe(byteLen(cf));
    expect(headerOffset(cf, 'EndFragment') - headerOffset(cf, 'StartFragment')).toBe(
      byteLen(markup),
    );
  });
});

describe('extractCfHtmlFragment', () => {
  test('round-trips what buildCfHtml wrote', () => {
    for (const markup of ['<b>hi</b>', '<p>你好 — café</p>', 'plain', '']) {
      expect(extractCfHtmlFragment(buildCfHtml(markup))).toBe(markup);
    }
  });

  test('extracts the fragment from a browser-style payload (CRLF, extra headers)', () => {
    const payload =
      'Version:0.9\r\nStartHTML:0000000097\r\nEndHTML:0000000169\r\n' +
      'StartFragment:0000000131\r\nEndFragment:0000000139\r\nSourceURL:https://x/\r\n' +
      '<html><body>\r\n<!--StartFragment-->grabbed<!--EndFragment-->\r\n</body></html>';
    expect(extractCfHtmlFragment(payload)).toBe('grabbed');
  });

  test('falls back to the markup when the fragment markers are absent', () => {
    const payload = 'Version:0.9\r\nStartHTML:0000000050\r\n<html><body><b>x</b></body></html>';
    expect(extractCfHtmlFragment(payload)).toContain('<b>x</b>');
  });
});

describe('dibBitsOffset', () => {
  test('32bpp BI_RGB pixels start right after the 40-byte header', () => {
    expect(dibBitsOffset(bitmapInfoHeader({ biBitCount: 32 }))).toBe(40);
    expect(dibBitsOffset(bitmapInfoHeader({ biBitCount: 24 }))).toBe(40);
  });

  test('BI_BITFIELDS adds three trailing color-mask DWORDs after a v3 header', () => {
    expect(dibBitsOffset(bitmapInfoHeader({ biBitCount: 32, biCompression: 3 }))).toBe(40 + 12);
  });

  test('BI_ALPHABITFIELDS adds four trailing color-mask DWORDs', () => {
    expect(dibBitsOffset(bitmapInfoHeader({ biBitCount: 32, biCompression: 6 }))).toBe(40 + 16);
  });

  test('a v5 header embeds its masks, so no extra mask bytes are added', () => {
    expect(dibBitsOffset(bitmapInfoHeader({ biSize: 124, biBitCount: 32, biCompression: 3 }))).toBe(
      124,
    );
  });

  test('8bpp uses a full 256-entry palette when biClrUsed is zero', () => {
    expect(dibBitsOffset(bitmapInfoHeader({ biBitCount: 8 }))).toBe(40 + 256 * 4);
  });

  test('a palettised depth honours an explicit biClrUsed entry count', () => {
    expect(dibBitsOffset(bitmapInfoHeader({ biBitCount: 8, biClrUsed: 16 }))).toBe(40 + 16 * 4);
  });
});

describe('buildPackedDib', () => {
  test('writes a 40-byte 32bpp BI_RGB bottom-up header', () => {
    const dib = buildPackedDib(2, 2, new Uint8Array(2 * 2 * 4), 8);
    const view = new DataView(dib.buffer);
    expect(view.getUint32(0, true)).toBe(40); // biSize
    expect(view.getInt32(4, true)).toBe(2); // biWidth
    expect(view.getInt32(8, true)).toBe(2); // biHeight > 0 -> bottom-up
    expect(view.getUint16(14, true)).toBe(32); // biBitCount
    expect(view.getUint32(16, true)).toBe(0); // biCompression = BI_RGB
    expect(dib.length).toBe(40 + 2 * 2 * 4);
  });

  test('flips top-down scanlines to the DIB bottom-up order', () => {
    // 1x2 image: top row = [1,2,3,4], bottom row = [5,6,7,8] (stride == row width).
    const topDown = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const dib = buildPackedDib(1, 2, topDown, 4);
    // DIB stores bottom-up: the visual bottom row [5..8] comes first.
    expect([...dib.subarray(40, 44)]).toEqual([5, 6, 7, 8]);
    expect([...dib.subarray(44, 48)]).toEqual([1, 2, 3, 4]);
  });

  test('drops scanline padding when the source stride exceeds the row width', () => {
    // 1px-wide rows (4 bytes) but a padded 8-byte stride; padding must not leak in.
    const padded = new Uint8Array([10, 11, 12, 13, 99, 99, 99, 99, 20, 21, 22, 23, 99, 99, 99, 99]);
    const dib = buildPackedDib(1, 2, padded, 8);
    expect([...dib.subarray(40, 44)]).toEqual([20, 21, 22, 23]); // bottom row first
    expect([...dib.subarray(44, 48)]).toEqual([10, 11, 12, 13]);
  });
});
