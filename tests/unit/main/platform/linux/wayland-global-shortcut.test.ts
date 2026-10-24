import { describe, expect, test } from 'bun:test';
import {
  isWaylandShortcutsSupported,
  shortcutIdFor,
} from '../../../../../src/main/platform/linux/wayland-global-shortcut';

describe('wayland global shortcuts helpers', () => {
  test('shortcutIdFor is a stable dbus-safe token', () => {
    expect(shortcutIdFor('MediaPlayPause')).toBe('bunmaska.MediaPlayPause');
    expect(shortcutIdFor('Ctrl+Shift+K')).toBe('bunmaska.Ctrl-Shift-K');
  });

  test('isWaylandShortcutsSupported needs a Wayland session and a bus', () => {
    expect(isWaylandShortcutsSupported({ XDG_SESSION_TYPE: 'x11' }, () => 1 as never)).toBe(false);
    expect(isWaylandShortcutsSupported({ WAYLAND_DISPLAY: 'wayland-0' }, () => null)).toBe(false);
    expect(isWaylandShortcutsSupported({ WAYLAND_DISPLAY: 'wayland-0' }, () => 1 as never)).toBe(
      true,
    );
  });
});
