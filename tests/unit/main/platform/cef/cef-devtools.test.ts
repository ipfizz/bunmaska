import { describe, expect, test } from 'bun:test';
import { CdpSession } from '../../../../../src/main/platform/cef/cef-devtools';

const session = (accept = true) => {
  const sent: Array<{ id: number; method: string; params: unknown }> = [];
  const cdp = new CdpSession((json) => {
    sent.push(JSON.parse(json));
    return accept;
  });
  return { cdp, sent };
};

describe('CdpSession', () => {
  test('resolves a call with the result of the matching response id', async () => {
    const { cdp, sent } = session();
    const first = cdp.call('Runtime.evaluate', { expression: '1' });
    const second = cdp.call('Page.enable');
    cdp.receive(JSON.stringify({ id: sent[1]?.id, result: { second: true } }));
    cdp.receive(JSON.stringify({ id: sent[0]?.id, result: { value: 1 } }));
    expect(await first).toEqual({ value: 1 });
    expect(await second).toEqual({ second: true });
    expect(sent.map((m) => m.method)).toEqual(['Runtime.evaluate', 'Page.enable']);
  });

  test('rejects a call whose response carries a protocol error', async () => {
    const { cdp, sent } = session();
    const call = cdp.call('Page.navigate', { url: 'x' });
    cdp.receive(JSON.stringify({ id: sent[0]?.id, error: { message: 'Invalid URL' } }));
    await expect(call).rejects.toThrow('Invalid URL');
  });

  test('rejects immediately when the channel refuses the message', async () => {
    const { cdp } = session(false);
    await expect(cdp.call('Page.enable')).rejects.toThrow('refused');
  });

  test('delivers events to every listener of that method, in order', () => {
    const { cdp } = session();
    const seen: string[] = [];
    cdp.on('Runtime.bindingCalled', (p) => seen.push(`a:${String(p['payload'])}`));
    cdp.on('Runtime.bindingCalled', (p) => seen.push(`b:${String(p['payload'])}`));
    cdp.on('Page.loadEventFired', () => seen.push('load'));
    cdp.receive(JSON.stringify({ method: 'Runtime.bindingCalled', params: { payload: 'x' } }));
    expect(seen).toEqual(['a:x', 'b:x']);
  });

  test('drops malformed messages and responses nobody is waiting for', () => {
    const { cdp } = session();
    expect(() => {
      cdp.receive('not json');
      cdp.receive('null');
      cdp.receive(JSON.stringify({ id: 999, result: {} }));
    }).not.toThrow();
  });

  test('close rejects in-flight calls and refuses new ones', async () => {
    const { cdp } = session();
    const inFlight = cdp.call('Runtime.evaluate');
    cdp.close('the browser closed');
    await expect(inFlight).rejects.toThrow('the browser closed');
    await expect(cdp.call('Page.enable')).rejects.toThrow('the browser closed');
  });
});
