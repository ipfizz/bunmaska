import { describe, expect, test } from 'bun:test';
import { InvalidArgumentError } from '../../../../src/common/errors';
import {
  type Cookie,
  cookieFromSetDetails,
  cookiesToRemove,
  domainMatches,
  filterCookies,
} from '../../../../src/main/api/cookie-util';

const cookie = (overrides: Partial<Cookie>): Cookie => ({
  name: 'a',
  value: '1',
  domain: 'example.com',
  path: '/',
  secure: false,
  httpOnly: false,
  ...overrides,
});

describe('domainMatches', () => {
  test('exact host matches, leading dot ignored', () => {
    expect(domainMatches('example.com', 'example.com')).toBe(true);
    expect(domainMatches('.example.com', 'example.com')).toBe(true);
  });

  test('subdomain of the cookie domain matches', () => {
    expect(domainMatches('.example.com', 'sub.example.com')).toBe(true);
    expect(domainMatches('example.com', 'deep.sub.example.com')).toBe(true);
  });

  test('suffix that is not a label boundary does NOT match', () => {
    expect(domainMatches('example.com', 'notexample.com')).toBe(false);
    expect(domainMatches('.example.com', 'badexample.com')).toBe(false);
  });

  test('unrelated host does not match', () => {
    expect(domainMatches('example.com', 'example.org')).toBe(false);
  });
});

describe('filterCookies', () => {
  const jar: Cookie[] = [
    cookie({ name: 'plain', domain: 'example.com', path: '/' }),
    cookie({ name: 'scoped', domain: '.example.com', path: '/app' }),
    cookie({ name: 'locked', domain: 'example.com', path: '/', secure: true }),
    cookie({ name: 'other', domain: 'other.org', path: '/' }),
  ];

  test('empty filter returns everything', () => {
    expect(filterCookies(jar, {})).toEqual(jar);
  });

  test('name filter is an exact match', () => {
    expect(filterCookies(jar, { name: 'plain' }).map((c) => c.name)).toEqual(['plain']);
  });

  test('domain filter matches equal domains and their subdomain cookies', () => {
    const names = filterCookies(jar, { domain: 'example.com' }).map((c) => c.name);
    expect(names).toEqual(['plain', 'scoped', 'locked']);
  });

  test('path filter is exact', () => {
    expect(filterCookies(jar, { path: '/app' }).map((c) => c.name)).toEqual(['scoped']);
  });

  test('http url excludes secure cookies; https includes them', () => {
    const http = filterCookies(jar, { url: 'http://example.com/' }).map((c) => c.name);
    const https = filterCookies(jar, { url: 'https://example.com/' }).map((c) => c.name);
    expect(http).toEqual(['plain']);
    expect(https).toEqual(['plain', 'locked']);
  });

  test('url path must be within the cookie path (label boundary respected)', () => {
    expect(filterCookies(jar, { url: 'http://example.com/app/x' }).map((c) => c.name)).toEqual([
      'plain',
      'scoped',
    ]);
    expect(filterCookies(jar, { url: 'http://example.com/apple' }).map((c) => c.name)).toEqual([
      'plain',
    ]);
  });

  test('unparsable filter url throws InvalidArgumentError', () => {
    expect(() => filterCookies(jar, { url: 'not a url' })).toThrow(InvalidArgumentError);
  });
});

describe('cookiesToRemove', () => {
  const jar: Cookie[] = [
    cookie({ name: 'sid', domain: 'example.com', path: '/' }),
    cookie({ name: 'sid', domain: '.example.com', path: '/app' }),
    cookie({ name: 'sid', domain: 'other.org', path: '/' }),
    cookie({ name: 'keep', domain: 'example.com', path: '/' }),
  ];

  test('matches by name plus url host/path, across domain forms', () => {
    const hits = cookiesToRemove(jar, 'https://example.com/app/page', 'sid');
    expect(hits.map((c) => c.domain)).toEqual(['example.com', '.example.com']);
  });

  test('a secure cookie is removable through a matching http url', () => {
    const jar2 = [cookie({ name: 'sid', secure: true })];
    expect(cookiesToRemove(jar2, 'http://example.com/', 'sid')).toHaveLength(1);
  });

  test('unparsable url throws InvalidArgumentError', () => {
    expect(() => cookiesToRemove(jar, ':::', 'sid')).toThrow(InvalidArgumentError);
  });
});

describe('cookieFromSetDetails', () => {
  test('derives domain and path from the url when absent', () => {
    const c = cookieFromSetDetails({ url: 'https://sub.example.com/x', name: 'a', value: '1' });
    expect(c).toEqual({
      name: 'a',
      value: '1',
      domain: 'sub.example.com',
      path: '/',
      secure: false,
      httpOnly: false,
    });
  });

  test('explicit fields win over derived ones', () => {
    const c = cookieFromSetDetails({
      url: 'https://example.com/',
      name: 'a',
      value: '1',
      domain: '.example.com',
      path: '/app',
      secure: true,
      httpOnly: true,
      expirationDate: 4102444800,
    });
    expect(c.domain).toBe('.example.com');
    expect(c.path).toBe('/app');
    expect(c.secure).toBe(true);
    expect(c.httpOnly).toBe(true);
    expect(c.expirationDate).toBe(4102444800);
  });

  test('name and value default to empty strings', () => {
    const c = cookieFromSetDetails({ url: 'https://example.com/' });
    expect(c.name).toBe('');
    expect(c.value).toBe('');
  });

  test('unparsable url throws InvalidArgumentError', () => {
    expect(() => cookieFromSetDetails({ url: 'nope' })).toThrow(InvalidArgumentError);
  });
});
