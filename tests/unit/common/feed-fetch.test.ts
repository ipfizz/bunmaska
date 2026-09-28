import { describe, expect, test } from 'bun:test';
import { assertSizeWithin, readFeedResponse } from '../../../src/common/feed-fetch';

describe('assertSizeWithin (zip-bomb guard)', () => {
  test('passes at or below the cap and throws above it', () => {
    expect(() => assertSizeWithin(100, 100, 'thing')).not.toThrow();
    expect(() => assertSizeWithin(101, 100, 'thing')).toThrow(/exceeds/);
  });
});

describe('readFeedResponse', () => {
  const KIB = new Uint8Array(1024);

  test('rejects a body past the cap without draining the rest of the stream', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1000) {
          controller.close();
        } else {
          controller.enqueue(KIB);
        }
      },
    });
    await expect(readFeedResponse(new Response(body), 'https://feed/a', 4 * 1024)).rejects.toThrow(
      /exceeds/,
    );
    expect(pulls).toBeLessThan(10);
  });

  test('returns a body within the cap', async () => {
    const bytes = await readFeedResponse(new Response(KIB), 'https://feed/a', 1024);
    expect(bytes.length).toBe(1024);
  });

  test('refuses a response that was redirected off https', async () => {
    const response = new Response('{}');
    Object.defineProperty(response, 'url', { value: 'http://evil.example/update.json' });
    await expect(readFeedResponse(response, 'https://feed/update.json', 1024)).rejects.toThrow(
      /http:\/\/evil\.example/,
    );
  });
});
