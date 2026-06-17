import type { Pointer } from 'bun:ffi';
import { describe, expect, it } from 'bun:test';
import {
  type AsyncStreamReader,
  CLIPBOARD_READ_CB_DEF,
  drainStreamAsync,
  linuxClipboardBackend,
  settleReadStreamAsync,
  settleReadText,
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

describe('drainStreamAsync (injected AsyncStreamReader, no real GInputStream)', () => {
  /** A reader resolving the given chunks in order, then EOF; records close(). */
  const makeReader = (
    chunks: Uint8Array[],
  ): { reader: AsyncStreamReader; closed: () => number } => {
    let index = 0;
    let closed = 0;
    return {
      reader: {
        read: () => Promise.resolve(chunks[index++] ?? new Uint8Array(0)),
        close: () => {
          closed += 1;
        },
      },
      closed: () => closed,
    };
  };

  it('concatenates multi-chunk reads and UTF-8 decodes them', async () => {
    const enc = new TextEncoder();
    const { reader, closed } = makeReader([enc.encode('<b>café'), enc.encode(' & co</b>')]);
    expect(await drainStreamAsync(reader)).toBe('<b>café & co</b>');
    expect(closed()).toBe(1);
  });

  it('decodes a multibyte char split across a chunk boundary (bytes joined before decode)', async () => {
    // '🎉' is 4 UTF-8 bytes (F0 9F 8E 89); split it 2/2 across two chunks.
    const party = new TextEncoder().encode('🎉'); // length 4
    const { reader } = makeReader([party.slice(0, 2), party.slice(2, 4)]);
    expect(await drainStreamAsync(reader)).toBe('🎉');
  });

  it('returns empty string and still closes when the stream is immediately EOF', async () => {
    const { reader, closed } = makeReader([]);
    expect(await drainStreamAsync(reader)).toBe('');
    expect(closed()).toBe(1);
  });

  it('still closes the stream when a read rejects (finally path)', async () => {
    let closed = 0;
    const reader: AsyncStreamReader = {
      read: () => Promise.reject(new Error('boom')),
      close: () => {
        closed += 1;
      },
    };
    await expect(drainStreamAsync(reader)).rejects.toThrow('boom');
    expect(closed).toBe(1);
  });
});

describe('settleReadStreamAsync (injected finish + async drain, no real clipboard)', () => {
  it('drains the stream when finish yields a non-null GInputStream*', async () => {
    const value = await settleReadStreamAsync({
      result: 1 as unknown as Pointer,
      finish: () => 42 as unknown as Pointer,
      drain: (stream) => {
        expect(stream).toBe(42 as unknown as Pointer);
        return Promise.resolve('<p>html</p>');
      },
    });
    expect(value).toBe('<p>html</p>');
  });

  it('returns empty string when finish yields null (no matching format)', async () => {
    const value = await settleReadStreamAsync({
      result: 0 as unknown as Pointer,
      finish: () => null,
      drain: () => {
        throw new Error('drain must not run on a null stream');
      },
    });
    expect(value).toBe('');
  });

  it('returns empty string when finish throws (GError path)', async () => {
    const value = await settleReadStreamAsync({
      result: 0 as unknown as Pointer,
      finish: () => {
        throw new Error('read failed');
      },
      drain: () => Promise.resolve('/should/not/return'),
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
