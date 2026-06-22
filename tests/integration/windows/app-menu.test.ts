import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import type { NativeMenuItemSpec } from '../../../src/main/platform/macos/cocoa-menu';
import { resolveWindowsEngineDir } from '../../../src/main/platform/windows/webkit2-ffi';
import { loadUser32 } from '../../../src/main/platform/windows/win32-ffi';
import { createWindowsMenuRealizer } from '../../../src/main/platform/windows/windows-menu';
import { NativeWin32Window } from '../../../src/main/platform/windows/windows-native-window';

/**
 * The application menu BAR on Windows — pure Win32 (no WebKit engine needed). A
 * realizer mirrors the menu onto each registered window via a real `CreateMenu`
 * bar + `SetMenu`; a menu click arrives as `WM_COMMAND` on the window's JSCallback
 * frame proc, which routes it to the realizer's stored `onClick`. These tests drive
 * the FULL native path: build a bar, attach it (`GetMenu`/`GetMenuItemCount` read it
 * back), then deliver a real `WM_COMMAND` and confirm the click fires. Windows-only.
 */
const WM_COMMAND = 0x0111;

/** A window wired to a fresh realizer exactly as the backend wires the real one. */
const wireWindow = (realizer: ReturnType<typeof createWindowsMenuRealizer>) => {
  const native = new NativeWin32Window({
    title: 'Bunmaska Menu Test',
    width: 400,
    height: 300,
    show: false,
    destroyOnClose: true,
  });
  native.onMenuCommand((id) => realizer.dispatchMenuCommand(id));
  realizer.registerAppMenuWindow({ setMenuBar: (bar) => native.setMenuBar(bar) });
  return native;
};

if (currentPlatform() === 'windows') {
  describe('Windows application menu bar', () => {
    test('installs a real menu bar and dispatches a click through the frame proc', () => {
      const realizer = createWindowsMenuRealizer();
      let clicked = 0;
      const native = wireWindow(realizer);
      try {
        const template: NativeMenuItemSpec[] = [
          {
            type: 'normal',
            label: 'Quit',
            enabled: true,
            keyEquivalent: '',
            onClick: () => (clicked += 1),
          },
          {
            type: 'submenu',
            label: 'Help',
            enabled: true,
            keyEquivalent: '',
            submenu: [{ type: 'normal', label: 'About', enabled: true, keyEquivalent: '' }],
          },
        ];
        // Mirror menu.ts: realize, then setApplicationMenu(handle).
        realizer.setApplicationMenu(realizer.realize(template));

        const user32 = loadUser32().symbols;
        const bar = user32.GetMenu(native.hwnd());
        expect(bar).not.toBe(0n);
        expect(user32.GetMenuItemCount(bar)).toBe(2); // Quit + Help

        // Position 0 is the clickable "Quit"; deliver its real WM_COMMAND.
        const quitId = user32.GetMenuItemID(bar, 0);
        expect(quitId).toBeGreaterThan(0);
        user32.SendMessageW(native.hwnd(), WM_COMMAND, BigInt(quitId), 0n);
        expect(clicked).toBe(1);

        // Position 1 is the "Help" submenu — popups have no command id.
        expect(user32.GetMenuItemID(bar, 1) >>> 0).toBe(0xffffffff);
      } finally {
        native.destroy();
      }
    });

    test('mirrors the menu onto every registered window (one HMENU each)', () => {
      const realizer = createWindowsMenuRealizer();
      const a = wireWindow(realizer);
      const b = wireWindow(realizer);
      try {
        const template: NativeMenuItemSpec[] = [
          {
            type: 'submenu',
            label: 'File',
            enabled: true,
            keyEquivalent: '',
            submenu: [{ type: 'normal', label: 'New', enabled: true, keyEquivalent: '' }],
          },
        ];
        realizer.setApplicationMenu(realizer.realize(template));

        const user32 = loadUser32().symbols;
        const barA = user32.GetMenu(a.hwnd());
        const barB = user32.GetMenu(b.hwnd());
        expect(barA).not.toBe(0n);
        expect(barB).not.toBe(0n);
        expect(barA).not.toBe(barB); // a distinct HMENU per window
        expect(user32.GetMenuItemCount(barA)).toBe(1);
        expect(user32.GetMenuItemCount(barB)).toBe(1);
      } finally {
        a.destroy();
        b.destroy();
      }
    });

    test('a window registered AFTER the menu is set still receives the bar', () => {
      const realizer = createWindowsMenuRealizer();
      realizer.setApplicationMenu(
        realizer.realize([
          { type: 'submenu', label: 'Edit', enabled: true, keyEquivalent: '', submenu: [] },
        ]),
      );
      const late = wireWindow(realizer);
      try {
        const user32 = loadUser32().symbols;
        const bar = user32.GetMenu(late.hwnd());
        expect(bar).not.toBe(0n);
        expect(user32.GetMenuItemCount(bar)).toBe(1);
      } finally {
        late.destroy();
      }
    });
  });

  // Engine-gated: the menu bar coexisting with a LIVE WebKit view (the JSCallback
  // frame proc must keep driving the runtime; the menu-bar client-area shrink must
  // not disturb the hosted WKView). Spawned in a subprocess like the other engine
  // probes — WebKit's multi-process IPC does not coexist with the bun:test host.
  const hasEngine = resolveWindowsEngineDir() !== undefined;
  describe.skipIf(!hasEngine)('application menu bar with a live engine', () => {
    test('executeJavaScript still works with an application menu attached', async () => {
      const fixture = `${import.meta.dir}/fixtures/app-menu-engine-probe.ts`;
      const proc = Bun.spawn([process.execPath, 'run', fixture], {
        env: { ...process.env },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      expect(stdout).toContain('MENU_ENGINE_OK 5');
    }, 40000);
  });
}
