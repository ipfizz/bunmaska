import { describe, expect, test } from 'bun:test';
import {
  WINDOW_HANDLER_NAME,
  windowControlsScript,
} from '../../../../src/main/platform/window-controls';

// Runs on every OS, so a page-world `__bunmaska` leak is caught on Windows CI too.
describe('windowControlsScript', () => {
  test('the default (isolated-world platforms) never leaks a __bunmaska handle', () => {
    const script = windowControlsScript();
    expect(script).not.toContain('__bunmaska');
    expect(script).not.toContain(WINDOW_HANDLER_NAME);
    // It still does the cross-platform job: mirror --app-region -> -webkit-app-region,
    // which is what makes macOS drag natively.
    expect(script).toContain('--app-region');
    expect(script).toContain('-webkit-app-region');
  });

  test('nativeOpChannel exposes window.__bunmaska.window controls + the op handler', () => {
    const script = windowControlsScript({ nativeOpChannel: true });
    expect(script).toContain('window.__bunmaska');
    expect(script).toContain('b.window');
    expect(script).toContain(WINDOW_HANDLER_NAME);
    for (const op of ['minimize', 'maximize', 'unmaximize', 'toggleMaximize', 'close']) {
      expect(script).toContain(`post('${op}')`);
    }
    // still mirrors --app-region, and wires the left-mousedown drag fallback.
    expect(script).toContain('-webkit-app-region');
    expect(script).toContain("addEventListener('mousedown'");
  });

  test('explicit nativeOpChannel:false is identical to the default', () => {
    expect(windowControlsScript({ nativeOpChannel: false })).toBe(windowControlsScript());
  });
});

type FakeElement = { appRegion: string; style: Map<string, string> };

/** Run the mirror against fake elements; `mutate()` fires the MutationObserver. */
const runMirror = (elements: FakeElement[]) => {
  let onMutation: () => void = () => undefined;
  let observed: unknown;
  const style = (el: FakeElement) => ({
    setProperty: (name: string, value: string) => el.style.set(name, value),
    removeProperty: (name: string) => el.style.delete(name),
  });
  const nodes = elements.map((el) => ({ el, style: style(el) }));
  const document = {
    readyState: 'complete',
    documentElement: {},
    addEventListener: () => undefined,
    querySelectorAll: () => nodes,
  };
  const getComputedStyle = ({ el }: { el: FakeElement }) => ({
    getPropertyValue: () => el.appRegion,
  });
  class MutationObserver {
    constructor(callback: () => void) {
      onMutation = callback;
    }
    observe(_target: unknown, options: unknown): void {
      observed = options;
    }
  }
  const raf = (callback: () => void) => callback();
  new Function(
    'document',
    'getComputedStyle',
    'requestAnimationFrame',
    'MutationObserver',
    windowControlsScript(),
  )(document, getComputedStyle, raf, MutationObserver);
  return { mutate: () => onMutation(), observed: () => observed };
};

describe('the --app-region mirror', () => {
  test('clears the region it mirrored once --app-region no longer applies', () => {
    const bar: FakeElement = { appRegion: 'drag', style: new Map() };
    const page = runMirror([bar]);
    expect(bar.style.get('-webkit-app-region')).toBe('drag');
    bar.appRegion = '';
    page.mutate();
    expect(bar.style.has('-webkit-app-region')).toBe(false);
  });

  test('leaves an author-set -webkit-app-region alone', () => {
    const bar: FakeElement = { appRegion: '', style: new Map([['-webkit-app-region', 'drag']]) };
    runMirror([bar]).mutate();
    expect(bar.style.get('-webkit-app-region')).toBe('drag');
  });

  test('re-runs on class changes but never on the style attribute it writes', () => {
    expect(runMirror([]).observed()).toMatchObject({
      attributes: true,
      attributeFilter: ['class'],
    });
  });
});
