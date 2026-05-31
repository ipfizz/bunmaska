import { describe, expect, it } from 'bun:test';
import {
  buildDispatchScript,
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
