import { describe, expect, test } from 'bun:test';
import { DOM_READY_HANDLER_NAME } from '../../../../src/main/platform/dom-ready';
import { dispatchScript, injectedScripts } from '../../../../src/main/platform/web-scripts';

/** Run a dispatch script against a fake `window`, as `evaluate_javascript` would. */
const run = (script: string, window: unknown): void => {
  new Function('window', script)(window);
};

describe('dispatchScript', () => {
  test('hands the exact envelope string to the isolated-world bridge', () => {
    const envelope = '{"msg":"he said \\"hi\\"\\n</script>\\u2028"}';
    const received: string[] = [];
    run(dispatchScript(envelope), {
      __bunmaska: { _dispatch: (json: string) => received.push(json) },
    });
    expect(received).toEqual([envelope]);
  });

  test('is a no-op before the bridge exists', () => {
    expect(() => run(dispatchScript('{}'), {})).not.toThrow();
  });
});

describe('injectedScripts', () => {
  const PRELOAD = 'window.userPreloadRan = true;';

  test('installs exposeInMainWorld before the user preload runs', () => {
    const { isolated } = injectedScripts({ preloadScript: PRELOAD, domReadyWorld: 'page' });
    const host = isolated.findIndex((source) => source.includes('exposeInMainWorld = '));
    expect(host).toBeGreaterThanOrEqual(0);
    expect(isolated.indexOf(PRELOAD)).toBeGreaterThan(host);
  });

  test('puts the dom-ready script only in the world the backend listens in', () => {
    const inWorld = (world: 'isolated' | 'page') => {
      const scripts = injectedScripts({ domReadyWorld: world });
      const has = (list: string[]) => list.some((s) => s.includes(DOM_READY_HANDLER_NAME));
      return [has(scripts.isolated), has(scripts.page)];
    };
    expect(inWorld('isolated')).toEqual([true, false]);
    expect(inWorld('page')).toEqual([false, true]);
  });
});
