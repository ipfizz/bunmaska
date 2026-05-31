import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  Notification,
  type NotificationBackend,
  type NotificationHandle,
  type NotificationSpec,
  setNotificationBackendForTesting,
} from '../../../../src/main/api/notification';

let presented: NotificationSpec[];
let closedCalls: number;
let supportedResult: boolean;
let closedListeners: Array<() => void>;

const makeHandle = (): NotificationHandle => ({
  close: () => {
    closedCalls += 1;
  },
  onClosed: (cb) => {
    closedListeners.push(cb);
  },
});

beforeEach(() => {
  presented = [];
  closedCalls = 0;
  supportedResult = true;
  closedListeners = [];
  const fake: NotificationBackend = {
    isSupported: () => supportedResult,
    present: (spec) => {
      presented.push(spec);
      return makeHandle();
    },
  };
  setNotificationBackendForTesting(fake);
});

afterEach(() => {
  setNotificationBackendForTesting(undefined);
});

describe('Notification construction', () => {
  test('is a Node EventEmitter for Electron compatibility', () => {
    expect(new Notification()).toBeInstanceOf(EventEmitter);
  });

  test('accepts no options', () => {
    const n = new Notification();
    expect(n.title).toBe('');
    expect(n.body).toBe('');
  });

  test('stores title, body, subtitle, silent from options', () => {
    const n = new Notification({
      title: 'Hi',
      body: 'There',
      subtitle: 'Sub',
      silent: true,
    });
    expect(n.title).toBe('Hi');
    expect(n.body).toBe('There');
    expect(n.subtitle).toBe('Sub');
    expect(n.silent).toBe(true);
  });

  test('silent defaults to false', () => {
    expect(new Notification({ title: 'x' }).silent).toBe(false);
  });
});

describe('Notification.show', () => {
  test('presents the notification via the backend with the current fields', () => {
    const n = new Notification({ title: 'T', body: 'B', subtitle: 'S', silent: true });
    n.show();
    expect(presented).toEqual([{ title: 'T', body: 'B', subtitle: 'S', silent: true }]);
  });

  test('emits a show event', () => {
    const n = new Notification({ title: 'T' });
    let fired = 0;
    n.on('show', () => {
      fired += 1;
    });
    n.show();
    expect(fired).toBe(1);
  });

  test('reflects mutated fields at show time', () => {
    const n = new Notification({ title: 'old' });
    n.title = 'new';
    n.body = 'body2';
    n.show();
    expect(presented[0]?.title).toBe('new');
    expect(presented[0]?.body).toBe('body2');
  });

  test('a second show presents again (re-show)', () => {
    const n = new Notification({ title: 'T' });
    n.show();
    n.show();
    expect(presented.length).toBe(2);
  });
});

describe('Notification.close', () => {
  test('closes the underlying handle from the last show', () => {
    const n = new Notification({ title: 'T' });
    n.show();
    n.close();
    expect(closedCalls).toBe(1);
  });

  test('is a no-op when never shown', () => {
    const n = new Notification({ title: 'T' });
    expect(() => n.close()).not.toThrow();
    expect(closedCalls).toBe(0);
  });

  test('is idempotent (a second close does not re-close the handle)', () => {
    const n = new Notification({ title: 'T' });
    n.show();
    n.close();
    n.close();
    expect(closedCalls).toBe(1);
  });
});

describe('Notification close event wiring', () => {
  test('emits close when the backend handle reports it was closed by the OS', () => {
    const n = new Notification({ title: 'T' });
    let fired = 0;
    n.on('close', () => {
      fired += 1;
    });
    n.show();
    expect(closedListeners.length).toBe(1);
    closedListeners[0]?.();
    expect(fired).toBe(1);
  });
});

describe('Notification.isSupported', () => {
  test('delegates to the backend (true)', () => {
    supportedResult = true;
    expect(Notification.isSupported()).toBe(true);
  });

  test('delegates to the backend (false)', () => {
    supportedResult = false;
    expect(Notification.isSupported()).toBe(false);
  });
});
