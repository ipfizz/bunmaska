import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  msgSendPtr,
  msgSendReturnsU8,
} from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { createWindowDelegate } from '../../../src/main/platform/macos/cocoa-window-delegate';
import type { WindowEventType } from '../../../src/main/platform/native';

/**
 * Unit-ish coverage of the NSWindowDelegate bridge against the live ObjC
 * runtime: sending its selectors directly (no real NSWindow) proves the IMP
 * routing — `windowShouldClose:` returns the inverted veto, `windowWillClose:`
 * runs `willClose`, and each notification routes to the right event type.
 */

if (currentPlatform() === 'macos') {
  describe('createWindowDelegate', () => {
    test('returns a non-null delegate instance handle', () => {
      const d = createWindowDelegate({
        shouldClose: () => false,
        willClose: () => undefined,
        event: () => undefined,
      });
      expect(d.handle).not.toBe(0n);
    });

    test('distinct delegates get distinct instance handles', () => {
      const a = createWindowDelegate({
        shouldClose: () => false,
        willClose: () => undefined,
        event: () => undefined,
      });
      const b = createWindowDelegate({
        shouldClose: () => false,
        willClose: () => undefined,
        event: () => undefined,
      });
      expect(a.handle).not.toBe(b.handle);
    });

    test('windowShouldClose: returns NO (0) when the listener vetoes', () => {
      const rt = cocoa();
      const d = createWindowDelegate({
        shouldClose: () => true,
        willClose: () => undefined,
        event: () => undefined,
      });
      const result = msgSendReturnsU8(d.handle, rt.selectors.get('windowShouldClose:'));
      expect(result).toBe(0);
    });

    test('windowShouldClose: returns YES (1) when the listener allows', () => {
      const rt = cocoa();
      const d = createWindowDelegate({
        shouldClose: () => false,
        willClose: () => undefined,
        event: () => undefined,
      });
      const result = msgSendReturnsU8(d.handle, rt.selectors.get('windowShouldClose:'));
      expect(result).toBe(1);
    });

    test('windowWillClose: runs the willClose handler', () => {
      const rt = cocoa();
      let closed = 0;
      const d = createWindowDelegate({
        shouldClose: () => false,
        willClose: () => {
          closed += 1;
        },
        event: () => undefined,
      });
      msgSendPtr(d.handle, rt.selectors.get('windowWillClose:'), 0n);
      expect(closed).toBe(1);
    });

    test('notification selectors route to the right event types', () => {
      const rt = cocoa();
      const seen: WindowEventType[] = [];
      const d = createWindowDelegate({
        shouldClose: () => false,
        willClose: () => undefined,
        event: (type) => seen.push(type),
      });
      const map: ReadonlyArray<readonly [string, WindowEventType]> = [
        ['windowDidBecomeKey:', 'focus'],
        ['windowDidResignKey:', 'blur'],
        ['windowDidResize:', 'resize'],
        ['windowDidMiniaturize:', 'minimize'],
        ['windowDidDeminiaturize:', 'restore'],
      ];
      for (const [selector] of map) {
        msgSendPtr(d.handle, rt.selectors.get(selector), 0n);
      }
      expect(seen).toEqual(map.map(([, type]) => type));
    });
  });
}
