import { describe, expect, test } from 'bun:test';
import { buildDispatchScript } from '../../../../../src/main/platform/linux/webkit-ipc';

/** Run a dispatch script against a fake `window`, as `evaluate_javascript` would. */
const run = (script: string, window: unknown): void => {
  new Function('window', script)(window);
};

describe('buildDispatchScript', () => {
  test('hands the exact envelope string to the isolated-world bridge', () => {
    const envelope = '{"msg":"he said \\"hi\\"\\n</script>\\u2028"}';
    const received: string[] = [];
    run(buildDispatchScript(envelope), {
      __bunmaska: { _dispatch: (json: string) => received.push(json) },
    });
    expect(received).toEqual([envelope]);
  });

  test('is a no-op before the bridge exists', () => {
    expect(() => run(buildDispatchScript('{}'), {})).not.toThrow();
  });
});
