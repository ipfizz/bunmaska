import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  msgSendPtr,
  msgSendReturnsU8,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import {
  createWindowDelegate,
  type WindowDelegateHandlers,
} from '../../../src/main/platform/macos/cocoa-window-delegate';
import type { WindowEventType } from '../../../src/main/platform/native';

const handlers = (overrides: Partial<WindowDelegateHandlers> = {}): WindowDelegateHandlers => ({
  shouldClose: () => false,
  willClose: () => undefined,
  event: () => undefined,
  ...overrides,
});

if (currentPlatform() === 'macos') {
  describe('createWindowDelegate', () => {
    test('windowShouldClose: returns NO (0) when the listener vetoes', () => {
      const rt = cocoa();
      const d = createWindowDelegate(handlers({ shouldClose: () => true }));
      const result = msgSendReturnsU8(d.handle, rt.selectors.get('windowShouldClose:'));
      expect(result).toBe(0);
    });

    test('windowShouldClose: returns YES (1) when the listener allows', () => {
      const rt = cocoa();
      const d = createWindowDelegate(handlers());
      const result = msgSendReturnsU8(d.handle, rt.selectors.get('windowShouldClose:'));
      expect(result).toBe(1);
    });

    test('windowWillClose: runs the willClose handler', () => {
      const rt = cocoa();
      let closed = 0;
      const d = createWindowDelegate(
        handlers({
          willClose: () => {
            closed += 1;
          },
        }),
      );
      msgSendPtr(d.handle, rt.selectors.get('windowWillClose:'), 0n);
      expect(closed).toBe(1);
    });

    test('notification selectors route to the right event types', () => {
      const rt = cocoa();
      const seen: WindowEventType[] = [];
      const d = createWindowDelegate(handlers({ event: (type) => seen.push(type) }));
      const map: ReadonlyArray<readonly [string, WindowEventType]> = [
        ['windowDidBecomeKey:', 'focus'],
        ['windowDidResignKey:', 'blur'],
        ['windowDidResize:', 'resize'],
        ['windowDidMove:', 'move'],
        ['windowDidMiniaturize:', 'minimize'],
        ['windowDidDeminiaturize:', 'restore'],
      ];
      for (const [selector] of map) {
        msgSendPtr(d.handle, rt.selectors.get(selector), 0n);
      }
      expect(seen).toEqual(map.map(([, type]) => type));
    });

    test('destroy stops routing: close is allowed and willClose no longer runs', () => {
      const rt = cocoa();
      let closed = 0;
      const d = createWindowDelegate(
        handlers({
          shouldClose: () => true,
          willClose: () => {
            closed += 1;
          },
        }),
      );
      rt.msgSend(d.handle, rt.selectors.get('retain'));
      d.destroy();
      expect(msgSendReturnsU8(d.handle, rt.selectors.get('windowShouldClose:'))).toBe(1);
      msgSendPtr(d.handle, rt.selectors.get('windowWillClose:'), 0n);
      expect(closed).toBe(0);
      rt.msgSend(d.handle, rt.selectors.get('release'));
    });
  });
}
