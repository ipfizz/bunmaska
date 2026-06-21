import { describe, expect, test } from 'bun:test';
import {
  buildCfHtml,
  extractCfHtmlFragment,
} from '../../../../../src/main/platform/windows/windows-clipboard';

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
