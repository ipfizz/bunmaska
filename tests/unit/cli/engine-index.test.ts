import { describe, expect, test } from 'bun:test';
import { BunmaskaError } from '../../../src/common/errors';
import { DEFAULT_ENGINE_FEED_URL, type RemoteFetch } from '../../../src/cli/engine-remote';
import {
  buildEngineIndex,
  engineFeedIndexUrl,
  fetchEngineIndex,
  parseEngineIndex,
} from '../../../src/cli/engine-index';

const ID = 'webkit-2-2.53.3-bunmaska1-windows-x64';

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

  test('rejects an entry whose id is not a valid engine-id', () => {
    expect(() =>
      parseEngineIndex(JSON.stringify({ version: 1, engines: [{ id: 'nope' }] })),
    ).toThrow(BunmaskaError);
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
