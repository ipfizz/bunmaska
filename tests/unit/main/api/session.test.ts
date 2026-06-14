import { afterEach, describe, expect, test } from 'bun:test';
import { Session, session, setSessionBackendForTesting } from '../../../../src/main/api/session';

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
    setSessionBackendForTesting({
      clearStorageData: () => {
        called += 1;
        return Promise.resolve();
      },
    });
    await session.defaultSession.clearStorageData();
    expect(called).toBe(1);
  });
});
