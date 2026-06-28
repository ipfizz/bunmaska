import { describe, expect, test } from 'bun:test';
import {
  WINDOW_HANDLER_NAME,
  windowControlsScript,
} from '../../../../src/main/platform/window-controls';

/**
 * Regression guard for the page-world title-bar script. On platforms with a real
 * isolated world (macOS/Linux) the page world must NEVER carry a `__bunmaska`
 * handle — that defeats context isolation (and trips the isolation e2e tests). The
 * control global is opt-in via `nativeOpChannel`, which only the page-world-bridge
 * platform (Windows) sets. This unit test runs on every OS, so the leak is caught
 * on Windows CI too, not only on the macOS/Linux e2e runners.
 */
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
