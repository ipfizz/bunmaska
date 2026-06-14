import { describe, expect, it } from 'bun:test';
import {
  buildDispatchScript,
  EXEC_HANDLER_NAME,
  EXEC_SIGNAL,
  HANDLER_NAME,
  PRELOAD_WORLD_NAME,
  SIGNAL,
} from '../../../../../src/main/platform/linux/webkit-ipc';

describe('webkit-ipc constants', () => {
  it('posts to and registers the "bunmaska" handler name', () => {
    expect(HANDLER_NAME).toBe('bunmaska');
  });

  it('connects the detailed script-message-received::bunmaska signal', () => {
    expect(SIGNAL).toBe('script-message-received::bunmaska');
  });

  it('uses the BunmaskaPreload isolated world name (matches the macOS backend)', () => {
    expect(PRELOAD_WORLD_NAME).toBe('BunmaskaPreload');
  });

  it('uses the page-world "bunmaskaExec" exec return-channel handler (matches macOS)', () => {
    expect(EXEC_HANDLER_NAME).toBe('bunmaskaExec');
  });

  it('connects the detailed script-message-received::bunmaskaExec signal', () => {
    expect(EXEC_SIGNAL).toBe('script-message-received::bunmaskaExec');
  });
});

describe('buildDispatchScript', () => {
  it('calls __bunmaska._dispatch with a JS-string-escaped JSON envelope', () => {
    const script = buildDispatchScript('{"a":1}');
    expect(script).toContain('window.__bunmaska._dispatch(');
    expect(script).toContain(JSON.stringify('{"a":1}'));
  });

  it('escapes quotes and backslashes so the literal is valid JS', () => {
    const envelope = '{"msg":"he said \\"hi\\""}';
    const script = buildDispatchScript(envelope);
    expect(script).toContain(JSON.stringify(envelope));
    expect(() => new Function(`return ${JSON.stringify(envelope)};`)).not.toThrow();
  });

  it('guards on window.__bunmaska before dispatching', () => {
    expect(buildDispatchScript('{}')).toContain('window.__bunmaska &&');
  });
});
