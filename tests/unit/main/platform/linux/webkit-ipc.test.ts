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
  it('posts to and registers the "sambar" handler name', () => {
    expect(HANDLER_NAME).toBe('sambar');
  });

  it('connects the detailed script-message-received::sambar signal', () => {
    expect(SIGNAL).toBe('script-message-received::sambar');
  });

  it('uses the SambarPreload isolated world name (matches the macOS backend)', () => {
    expect(PRELOAD_WORLD_NAME).toBe('SambarPreload');
  });

  it('uses the page-world "sambarExec" exec return-channel handler (matches macOS)', () => {
    expect(EXEC_HANDLER_NAME).toBe('sambarExec');
  });

  it('connects the detailed script-message-received::sambarExec signal', () => {
    expect(EXEC_SIGNAL).toBe('script-message-received::sambarExec');
  });
});

describe('buildDispatchScript', () => {
  it('calls __sambar._dispatch with a JS-string-escaped JSON envelope', () => {
    const script = buildDispatchScript('{"a":1}');
    expect(script).toContain('window.__sambar._dispatch(');
    expect(script).toContain(JSON.stringify('{"a":1}'));
  });

  it('escapes quotes and backslashes so the literal is valid JS', () => {
    const envelope = '{"msg":"he said \\"hi\\""}';
    const script = buildDispatchScript(envelope);
    expect(script).toContain(JSON.stringify(envelope));
    expect(() => new Function(`return ${JSON.stringify(envelope)};`)).not.toThrow();
  });

  it('guards on window.__sambar before dispatching', () => {
    expect(buildDispatchScript('{}')).toContain('window.__sambar &&');
  });
});
