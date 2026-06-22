import { beforeEach, describe, expect, test } from 'bun:test';
import { IpcMainImpl } from '../../../../src/main/api/ipc-main';
import type { InvokeEnvelope, SendEnvelope } from '../../../../src/main/ipc/ipc-protocol';

const send = (channel: string, ...args: unknown[]): SendEnvelope => ({
  kind: 'send',
  channel,
  args,
});
const invoke = (id: number, channel: string, ...args: unknown[]): InvokeEnvelope => ({
  kind: 'invoke',
  id,
  channel,
  args,
});
const event = { sender: undefined };

let ipc: IpcMainImpl;
beforeEach(() => {
  ipc = new IpcMainImpl();
});

describe('ipcMain.on / dispatch send', () => {
  test('invokes a registered listener with the event and args', async () => {
    const calls: Array<readonly unknown[]> = [];
    ipc.on('ping', (_e, ...args) => calls.push(args));
    await ipc.dispatch(send('ping', 1, 'two'), event);
    expect(calls).toEqual([[1, 'two']]);
  });

  test('a send envelope produces no reply', async () => {
    ipc.on('ping', () => undefined);
    expect(await ipc.dispatch(send('ping'), event)).toBeUndefined();
  });

  test('multiple listeners all fire', async () => {
    let count = 0;
    ipc.on('e', () => {
      count += 1;
    });
    ipc.on('e', () => {
      count += 1;
    });
    await ipc.dispatch(send('e'), event);
    expect(count).toBe(2);
  });

  test('removeListener detaches a handler', async () => {
    let count = 0;
    const fn = (): void => {
      count += 1;
    };
    ipc.on('e', fn);
    ipc.removeListener('e', fn);
    await ipc.dispatch(send('e'), event);
    expect(count).toBe(0);
  });

  test('once fires only on the first dispatch', async () => {
    let count = 0;
    ipc.once('e', () => {
      count += 1;
    });
    await ipc.dispatch(send('e'), event);
    await ipc.dispatch(send('e'), event);
    expect(count).toBe(1);
  });
});

describe('ipcMain.handle / dispatch invoke', () => {
  test('returns an ok reply with the handler result', async () => {
    ipc.handle('add', (_e, a, b) => (a as number) + (b as number));
    expect(await ipc.dispatch(invoke(1, 'add', 2, 3), event)).toEqual({
      kind: 'reply',
      id: 1,
      ok: true,
      result: 5,
    });
  });

  test('awaits an async handler', async () => {
    ipc.handle('slow', async (_e, x) => {
      await Promise.resolve();
      return (x as number) * 2;
    });
    expect(await ipc.dispatch(invoke(2, 'slow', 21), event)).toEqual({
      kind: 'reply',
      id: 2,
      ok: true,
      result: 42,
    });
  });

  test('returns an error reply when no handler is registered', async () => {
    const reply = await ipc.dispatch(invoke(3, 'missing'), event);
    expect(reply).toEqual({
      kind: 'reply',
      id: 3,
      ok: false,
      error: "No handler registered for 'missing'",
    });
  });

  test('returns an error reply when the handler throws', async () => {
    ipc.handle('boom', () => {
      throw new Error('kaboom');
    });
    expect(await ipc.dispatch(invoke(4, 'boom'), event)).toEqual({
      kind: 'reply',
      id: 4,
      ok: false,
      error: 'kaboom',
    });
  });

  test('removeHandler unregisters the handler', async () => {
    ipc.handle('x', () => 1);
    ipc.removeHandler('x');
    const reply = await ipc.dispatch(invoke(5, 'x'), event);
    expect(reply).toMatchObject({ ok: false });
  });

  test('handle replaces a prior handler for the same channel (one handler per channel)', async () => {
    ipc.handle('x', () => 1);
    ipc.handle('x', () => 2);
    expect(await ipc.dispatch(invoke(6, 'x'), event)).toMatchObject({ ok: true, result: 2 });
  });
});
