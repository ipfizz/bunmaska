// Capped, https-only GETs shared by the app auto-updater and the engine installer.

const LOCAL_FEED_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https, or http on localhost for dev. */
export const isSecureFeedUrl = (parsed: URL): boolean =>
  parsed.protocol === 'https:' ||
  (parsed.protocol === 'http:' && LOCAL_FEED_HOSTS.has(parsed.hostname));

export const assertSizeWithin = (length: number, max: number, what: string): void => {
  if (length > max) {
    throw new Error(`${what} exceeds the ${max}-byte limit (got ${length})`);
  }
};

/** The body of a feed GET, read with a running byte cap; a redirect off https is refused. */
export const readFeedResponse = async (
  response: Response,
  url: string,
  maxBytes: number,
): Promise<Uint8Array> => {
  if (!response.ok) {
    throw new Error(`GET ${url} failed (${response.status})`);
  }
  if (response.url !== '' && !isSecureFeedUrl(new URL(response.url))) {
    throw new Error(`GET ${url} was redirected to insecure ${response.url}`);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.length;
    assertSizeWithin(total, maxBytes, `GET ${url}`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/** Rejects once the body passes `maxBytes`, without buffering the rest. */
export const fetchCapped = async (url: string, maxBytes: number): Promise<Uint8Array> =>
  readFeedResponse(await fetch(url), url, maxBytes);
