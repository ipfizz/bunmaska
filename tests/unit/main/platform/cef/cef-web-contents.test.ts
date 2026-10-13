import { describe, expect, test } from 'bun:test';
import { htmlDataUrl } from '../../../../../src/main/platform/cef/cef-web-contents';

const decode = (url: string): string =>
  Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8');

describe('htmlDataUrl', () => {
  test('encodes the markup as a UTF-8 base64 data URL', () => {
    const url = htmlDataUrl('<p>héllo</p>');
    expect(url.startsWith('data:text/html;charset=utf-8;base64,')).toBe(true);
    expect(decode(url)).toBe('<p>héllo</p>');
  });

  test('a base URL becomes an escaped <base> element ahead of the markup', () => {
    expect(decode(htmlDataUrl('<p>x</p>', 'file:///a "b"&c/'))).toBe(
      '<base href="file:///a &quot;b&quot;&amp;c/"><p>x</p>',
    );
  });
});
