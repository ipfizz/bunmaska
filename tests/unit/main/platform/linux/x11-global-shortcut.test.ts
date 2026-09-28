import { describe, expect, test } from 'bun:test';
import { isWaylandSession } from '../../../../../src/main/platform/linux/x11-global-shortcut';

describe('isWaylandSession', () => {
  test('is true when WAYLAND_DISPLAY is set, even with an XWayland DISPLAY', () => {
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' })).toBe(true);
  });

  test('is true when the session type is wayland', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
  });

  test('is false for an X11 session', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })).toBe(false);
    expect(isWaylandSession({ WAYLAND_DISPLAY: '', DISPLAY: ':99' })).toBe(false);
  });
});
