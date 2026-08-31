import { afterEach, describe, expect, test } from 'bun:test';
import { InvalidArgumentError, UnsupportedPlatformError } from '../../../../src/common/errors';
import type { Cookie, CookieFilter } from '../../../../src/main/api/cookie-util';
import {
  Session,
  type SessionBackend,
  session,
  setSessionBackendForTesting,
} from '../../../../src/main/api/session';

/** A fake backend recording calls; every method resolves unless overridden. */
const fakeBackend = (overrides: Partial<SessionBackend> = {}) => {
  const calls: { getCookies: CookieFilter[]; setCookie: Cookie[]; removeCookie: string[][] } = {
    getCookies: [],
    setCookie: [],
    removeCookie: [],
  };
  const backend: SessionBackend = {
    clearStorageData: () => Promise.resolve(),
    getCookies: (filter) => {
      calls.getCookies.push(filter);
      return Promise.resolve([]);
    },
    setCookie: (cookie) => {
      calls.setCookie.push(cookie);
      return Promise.resolve();
    },
    removeCookie: (url, name) => {
      calls.removeCookie.push([url, name]);
      return Promise.resolve();
    },
    ...overrides,
  };
  setSessionBackendForTesting(backend);
  return calls;
};

afterEach(() => {
  session.defaultSession.resetForTesting();
  setSessionBackendForTesting(undefined);
});

describe('session.defaultSession', () => {
  test('exposes a default Session instance', () => {
    expect(session.defaultSession).toBeInstanceOf(Session);
  });

  test('getUserAgent defaults to an empty override', () => {
    expect(session.defaultSession.getUserAgent()).toBe('');
  });

  test('setUserAgent stores the override and getUserAgent returns it', () => {
    session.defaultSession.setUserAgent('Bunmaska/1.0');
    expect(session.defaultSession.getUserAgent()).toBe('Bunmaska/1.0');
  });

  test('resetForTesting clears the override', () => {
    session.defaultSession.setUserAgent('Bunmaska/1.0');
    session.defaultSession.resetForTesting();
    expect(session.defaultSession.getUserAgent()).toBe('');
  });

  test('clearStorageData delegates to the native backend', async () => {
    let called = 0;
    fakeBackend({
      clearStorageData: () => {
        called += 1;
        return Promise.resolve();
      },
    });
    await session.defaultSession.clearStorageData();
    expect(called).toBe(1);
  });
});

describe('session.defaultSession.cookies', () => {
  test('get passes the filter through to the backend', async () => {
    const calls = fakeBackend();
    await session.defaultSession.cookies.get({ name: 'sid', url: 'https://example.com/' });
    expect(calls.getCookies).toEqual([{ name: 'sid', url: 'https://example.com/' }]);
  });

  test('get with no filter passes an empty filter', async () => {
    const calls = fakeBackend();
    await session.defaultSession.cookies.get();
    expect(calls.getCookies).toEqual([{}]);
  });

  test('set normalizes details into a full cookie for the backend', async () => {
    const calls = fakeBackend();
    await session.defaultSession.cookies.set({
      url: 'https://example.com/',
      name: 'sid',
      value: 'v',
    });
    expect(calls.setCookie).toEqual([
      { name: 'sid', value: 'v', domain: 'example.com', path: '/', secure: false, httpOnly: false },
    ]);
  });

  test('set without a url rejects with InvalidArgumentError, backend untouched', async () => {
    const calls = fakeBackend();
    const malformed = {} as unknown as Parameters<typeof session.defaultSession.cookies.set>[0];
    await expect(session.defaultSession.cookies.set(malformed)).rejects.toThrow(
      'cookies.set requires a url',
    );
    expect(calls.setCookie).toEqual([]);
  });

  test('set with an unparsable url rejects with InvalidArgumentError', async () => {
    fakeBackend();
    await expect(
      session.defaultSession.cookies.set({ url: 'not a url', name: 'a' }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  test('remove passes url and name through to the backend', async () => {
    const calls = fakeBackend();
    await session.defaultSession.cookies.remove('https://example.com/', 'sid');
    expect(calls.removeCookie).toEqual([['https://example.com/', 'sid']]);
  });

  test('remove without url or name rejects with InvalidArgumentError', async () => {
    const calls = fakeBackend();
    await expect(session.defaultSession.cookies.remove('', 'sid')).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
    await expect(
      session.defaultSession.cookies.remove('https://example.com/', ''),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(calls.removeCookie).toEqual([]);
  });

  test('a backend rejection propagates to the caller', async () => {
    fakeBackend({
      getCookies: () => Promise.reject(new UnsupportedPlatformError('nope')),
    });
    await expect(session.defaultSession.cookies.get()).rejects.toBeInstanceOf(
      UnsupportedPlatformError,
    );
  });
});
