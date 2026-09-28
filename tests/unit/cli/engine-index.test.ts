import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../src/common/errors';
import { DEFAULT_ENGINE_FEED_URL, type RemoteFetch } from '../../../src/cli/engine-remote';
import {
  buildEngineIndex,
  engineFeedIndexUrl,
  fetchEngineIndex,
  mergeEngineIndex,
  parseEngineIndex,
} from '../../../src/cli/engine-index';

const ID = 'webkit-2-2.53.3-bunmaska1-windows-x64';
const CEF_ID = 'cef-154-154.0.8037.58-bunmaska1-macos-arm64';

describe('engineFeedIndexUrl', () => {
  test('maps a feed base to <base>/index.json (official by default, trailing slash ok)', () => {
    expect(engineFeedIndexUrl()).toBe(`${DEFAULT_ENGINE_FEED_URL}/index.json`);
    expect(engineFeedIndexUrl('https://mirror.example/e/')).toBe(
      'https://mirror.example/e/index.json',
    );
  });
});

describe('parseEngineIndex', () => {
  test('parses entries and derives os/arch/upstream/family from the id', () => {
    const entries = parseEngineIndex(
      JSON.stringify({
        version: 1,
        engines: [{ id: ID, size: 58694158, hash: 'd67ec3b7', soname: 'WebKit2.dll' }],
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: ID,
      os: 'windows',
      arch: 'x64',
      upstream: '2.53.3',
      engine: 'webkit',
      size: 58694158,
    });
  });

  test('tolerates an empty engine list', () => {
    expect(parseEngineIndex(JSON.stringify({ version: 1, engines: [] }))).toEqual([]);
  });

  test('rejects malformed JSON', () => {
    expect(() => parseEngineIndex('not json')).toThrow(BunmaskaError);
  });

  test('skips entries this client cannot parse, so a newer engine family never breaks it', () => {
    const entries = parseEngineIndex(
      JSON.stringify({ version: 1, engines: [{ id: CEF_ID }, { id: ID }, { id: 'nope' }] }),
    );
    expect(entries.map((e) => e.id)).toEqual([ID]);
  });

  test('rejects an entry without a string id', () => {
    expect(() => parseEngineIndex(JSON.stringify({ version: 1, engines: [{ id: 7 }] }))).toThrow(
      BunmaskaError,
    );
  });

  test('rejects a non-object / missing engines array', () => {
    expect(() => parseEngineIndex(JSON.stringify({ version: 1 }))).toThrow(BunmaskaError);
    expect(() => parseEngineIndex(JSON.stringify([]))).toThrow(BunmaskaError);
  });
});

describe('buildEngineIndex', () => {
  test('round-trips through parseEngineIndex', () => {
    const json = buildEngineIndex([{ id: ID, size: 10, hash: 'abc', soname: 'WebKit2.dll' }]);
    const parsed = parseEngineIndex(json);
    expect(parsed[0]?.id).toBe(ID);
    expect(parsed[0]?.hash).toBe('abc');
    // stable, pretty, newline-terminated (like the other feed files)
    expect(json.endsWith('\n')).toBe(true);
  });
});

describe('fetchEngineIndex', () => {
  test('fetches <base>/index.json and returns parsed entries', async () => {
    const body = buildEngineIndex([{ id: ID, size: 5, hash: 'h', soname: 'WebKit2.dll' }]);
    const fetch: RemoteFetch = async (url) => {
      expect(url).toBe(`${DEFAULT_ENGINE_FEED_URL}/index.json`);
      return new TextEncoder().encode(body);
    };
    const entries = await fetchEngineIndex(DEFAULT_ENGINE_FEED_URL, fetch);
    expect(entries[0]?.id).toBe(ID);
  });
});

describe('mergeEngineIndex', () => {
  const LINUX_ID = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';

  test('starts a new index when none is published yet', () => {
    const json = mergeEngineIndex(undefined, {
      id: ID,
      hash: 'abc',
      size: 10,
      soname: 'WebKit2.dll',
    });
    const parsed = parseEngineIndex(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: ID, hash: 'abc', size: 10 });
  });

  test('adds the entry and keeps the others, sorted by id', () => {
    const existing = buildEngineIndex([
      { id: LINUX_ID, size: 2, hash: 'keep', soname: 'libwebkitgtk-6.0.so.4' },
    ]);
    const json = mergeEngineIndex(existing, { id: ID, hash: 'new', size: 99 });
    const parsed = parseEngineIndex(json);
    expect(parsed.map((e) => e.id)).toEqual([ID, LINUX_ID].sort());
    expect(parsed.find((e) => e.id === ID)).toMatchObject({ hash: 'new', size: 99 });
    expect(parsed.find((e) => e.id === LINUX_ID)).toMatchObject({ hash: 'keep' });
  });

  test('keeps entries this client cannot parse', () => {
    const existing = buildEngineIndex([{ id: CEF_ID, hash: 'blink' }]);
    const json = mergeEngineIndex(existing, { id: ID, hash: 'new' });
    expect(JSON.parse(json).engines.map((e: { id: string }) => e.id)).toEqual([CEF_ID, ID].sort());
  });

  test('rejects a malformed engine id before it enters the index', () => {
    expect(() => mergeEngineIndex(undefined, { id: '../evil', hash: 'x' })).toThrow();
  });
});
