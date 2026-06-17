import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildProtocolResponse,
  normalizeScheme,
  protocol,
  schemeOfUrl,
} from '../../../../src/main/api/protocol';

/**
 * Unit tests for the PURE core of the `protocol` module: the scheme registry,
 * the URL→scheme parser, the response-builder (string→utf8 bytes, default
 * mimeType, unknown/undefined handling). No FFI, no real web view.
 */

afterEach(() => {
  // Each test starts from a clean registry so order does not matter.
  for (const scheme of protocol.getRegisteredSchemes()) {
    protocol.unhandle(scheme);
  }
});

describe('normalizeScheme', () => {
  test('lowercases and trims a scheme', () => {
    expect(normalizeScheme('  APP  ')).toBe('app');
  });

  test('strips a trailing :// or :', () => {
    expect(normalizeScheme('app://')).toBe('app');
    expect(normalizeScheme('app:')).toBe('app');
  });
});

describe('schemeOfUrl', () => {
  test('extracts the scheme from a full url', () => {
    expect(schemeOfUrl('app://host/index.html')).toBe('app');
  });

  test('lowercases the parsed scheme', () => {
    expect(schemeOfUrl('APP://Host/Path')).toBe('app');
  });

  test('returns undefined for a url with no scheme', () => {
    expect(schemeOfUrl('/no/scheme/here')).toBeUndefined();
  });
});

describe('buildProtocolResponse', () => {
  test('utf8-encodes a string body and defaults the mimeType to text/html', () => {
    const built = buildProtocolResponse(() => ({ data: 'hi' }));
    expect(built).not.toBeUndefined();
    if (built === undefined) {
      throw new Error('expected a built response');
    }
    expect(Array.from(built.bytes)).toEqual([104, 105]);
    expect(built.mimeType).toBe('text/html');
  });

  test('passes Uint8Array bytes through unchanged and honours an explicit mimeType', () => {
    const raw = new Uint8Array([1, 2, 3]);
    const built = buildProtocolResponse(() => ({
      data: raw,
      mimeType: 'application/octet-stream',
    }));
    if (built === undefined) {
      throw new Error('expected a built response');
    }
    expect(Array.from(built.bytes)).toEqual([1, 2, 3]);
    expect(built.mimeType).toBe('application/octet-stream');
  });

  test('returns undefined when the handler returns undefined', () => {
    expect(buildProtocolResponse(() => undefined)).toBeUndefined();
  });

  test('utf8-encodes multibyte characters by length, not character count', () => {
    const built = buildProtocolResponse(() => ({ data: '€' }));
    if (built === undefined) {
      throw new Error('expected a built response');
    }
    // U+20AC is three UTF-8 bytes.
    expect(built.bytes.length).toBe(3);
  });
});

describe('protocol registry', () => {
  test('handle registers a scheme that isProtocolHandled then reports', () => {
    expect(protocol.isProtocolHandled('app')).toBe(false);
    protocol.handle('app', () => ({ data: 'x' }));
    expect(protocol.isProtocolHandled('app')).toBe(true);
  });

  test('handle normalizes the scheme so case/suffix do not matter', () => {
    protocol.handle('APP://', () => ({ data: 'x' }));
    expect(protocol.isProtocolHandled('app')).toBe(true);
    expect(protocol.getRegisteredSchemes()).toContain('app');
  });

  test('unhandle removes the scheme', () => {
    protocol.handle('app', () => ({ data: 'x' }));
    protocol.unhandle('app');
    expect(protocol.isProtocolHandled('app')).toBe(false);
  });

  test('getRegisteredSchemes lists every registered scheme', () => {
    protocol.handle('app', () => ({ data: 'a' }));
    protocol.handle('media', () => ({ data: 'b' }));
    const schemes = protocol.getRegisteredSchemes();
    expect(schemes).toContain('app');
    expect(schemes).toContain('media');
  });

  test('dispatch returns the built response for a registered url scheme', () => {
    protocol.handle('app', (request) => ({ data: `served:${request.url}` }));
    const built = protocol.dispatch('app://host/index.html');
    if (built === undefined) {
      throw new Error('expected a dispatched response');
    }
    expect(new TextDecoder().decode(built.bytes)).toBe('served:app://host/index.html');
    expect(built.mimeType).toBe('text/html');
  });

  test('dispatch returns undefined for an unregistered scheme', () => {
    expect(protocol.dispatch('nope://host/x')).toBeUndefined();
  });

  test('dispatch returns undefined when the handler returns undefined (404-ish)', () => {
    protocol.handle('app', () => undefined);
    expect(protocol.dispatch('app://host/missing')).toBeUndefined();
  });
});
