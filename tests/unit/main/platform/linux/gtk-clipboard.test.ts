import type { Pointer } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import {
  CLIPBOARD_READ_CB_DEF,
  drainStream,
  linuxClipboardBackend,
  settleReadStream,
  settleReadText,
  type StreamReader,
} from '../../../../../src/main/platform/linux/gtk-clipboard';

describe('CLIPBOARD_READ_CB_DEF (GAsyncReadyCallback ABI, shape-only)', () => {
  it('is (source, result, user_data) -> void', () => {
    expect(CLIPBOARD_READ_CB_DEF.args).toEqual(['ptr', 'ptr', 'ptr']);
    expect(CLIPBOARD_READ_CB_DEF.returns).toBe('void');
  });
});

describe('linuxClipboardBackend shape', () => {
  it('exposes readText, writeText, readHTML, writeHTML and clear', () => {
    expect(typeof linuxClipboardBackend.readText).toBe('function');
    expect(typeof linuxClipboardBackend.writeText).toBe('function');
    expect(typeof linuxClipboardBackend.readHTML).toBe('function');
    expect(typeof linuxClipboardBackend.writeHTML).toBe('function');
    expect(typeof linuxClipboardBackend.clear).toBe('function');
  });
});

describe('drainStream (injected StreamReader, no real GInputStream)', () => {
  /** A reader yielding the given chunks in order, then EOF; records close(). */
  const makeReader = (chunks: Uint8Array[]): { reader: StreamReader; closed: () => number } => {
    let index = 0;
    let closed = 0;
    return {
      reader: {
        read: () => chunks[index++] ?? new Uint8Array(0),
        close: () => {
          closed += 1;
        },
      },
      closed: () => closed,
    };
  };

  it('concatenates multi-chunk reads and UTF-8 decodes them', () => {
    const enc = new TextEncoder();
    const { reader, closed } = makeReader([enc.encode('<b>café'), enc.encode(' & co</b>')]);
    expect(drainStream(reader)).toBe('<b>café & co</b>');
    expect(closed()).toBe(1);
  });

  it('returns empty string and still closes when the stream is immediately EOF', () => {
    const { reader, closed } = makeReader([]);
    expect(drainStream(reader)).toBe('');
    expect(closed()).toBe(1);
  });
});

describe('settleReadStream (injected finish + drain, no real clipboard)', () => {
  it('drains the stream when finish yields a non-null GInputStream*', () => {
    const value = settleReadStream({
      result: 1 as unknown as Pointer,
      finish: () => 42 as unknown as Pointer,
      drain: (stream) => {
        expect(stream).toBe(42 as unknown as Pointer);
        return '<p>html</p>';
      },
    });
    expect(value).toBe('<p>html</p>');
  });

  it('returns empty string when finish yields null (no matching format)', () => {
    const value = settleReadStream({
      result: 0 as unknown as Pointer,
      finish: () => null,
      drain: () => {
        throw new Error('drain must not run on a null stream');
      },
    });
    expect(value).toBe('');
  });

  it('returns empty string when finish throws (GError path)', () => {
    const value = settleReadStream({
      result: 0 as unknown as Pointer,
      finish: () => {
        throw new Error('read failed');
      },
      drain: () => '/should/not/return',
    });
    expect(value).toBe('');
  });
});

describe('settleReadText (injected finish-fn, no real clipboard)', () => {
  it('returns the read string when the injected finish-fn yields a non-null char*', () => {
    const fakeResult = 7 as unknown as Pointer;
    const value = settleReadText({
      result: fakeResult,
      finish: (r) => {
        expect(r).toBe(fakeResult);
        return 99 as unknown as Pointer;
      },
      readString: (ptr) => {
        expect(ptr).toBe(99 as unknown as Pointer);
        return 'clipboard text';
      },
    });
    expect(value).toBe('clipboard text');
  });

  it('returns empty string when the injected finish-fn yields null (empty/none)', () => {
    const value = settleReadText({
      result: 0 as unknown as Pointer,
      finish: () => null,
      readString: () => {
        throw new Error('readString must not be called on a null char*');
      },
    });
    expect(value).toBe('');
  });

  it('returns empty string when finish throws (GError path)', () => {
    const value = settleReadText({
      result: 0 as unknown as Pointer,
      finish: () => {
        throw new Error('read failed');
      },
      readString: () => '/should/not/return',
    });
    expect(value).toBe('');
  });
});
