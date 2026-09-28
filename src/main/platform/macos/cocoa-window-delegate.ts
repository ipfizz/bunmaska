import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { WindowEventType } from '../native';
import type { Handle } from './objc';

/** `NSWindowDelegate` bridge (D026): one instance per window, routed by the IMP's `self`. */

/** The per-window JS handlers an `NSWindowDelegate` routes notifications to. */
export type WindowDelegateHandlers = {
  /** Return `true` to VETO the close (windowShouldClose: returns NO). */
  readonly shouldClose: () => boolean;
  /** Runs on every close path once AppKit has committed (windowWillClose:). */
  readonly willClose: () => void;
  /** A non-preventable lifecycle event fired. */
  readonly event: (type: WindowEventType) => void;
};

const registry = new Map<Handle, WindowDelegateHandlers>();

let delegateClass: Handle | undefined;

/** Plain notifications; the preventable close pair is handled separately below. */
const NOTIFICATION_EVENTS: ReadonlyArray<readonly [selector: string, type: WindowEventType]> = [
  ['windowDidBecomeKey:', 'focus'],
  ['windowDidResignKey:', 'blur'],
  ['windowDidResize:', 'resize'],
  ['windowDidMove:', 'move'],
  ['windowDidMiniaturize:', 'minimize'],
  ['windowDidDeminiaturize:', 'restore'],
];

const ensureDelegateClass = (): Handle => {
  if (delegateClass !== undefined) {
    return delegateClass;
  }
  delegateClass = defineObjcClass('BunmaskaWindowDelegate', 'NSObject', [
    {
      selector: 'windowShouldClose:',
      typeEncoding: 'c@:@',
      args: ['object'],
      returns: 'bool',
      impl: (self) => {
        const handlers = registry.get(self);
        if (handlers === undefined) {
          return 1;
        }
        // Inverted: shouldClose() is true to veto, the BOOL is NO (0) to veto.
        return handlers.shouldClose() ? 0 : 1;
      },
    },
    {
      selector: 'windowWillClose:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (self) => {
        registry.get(self)?.willClose();
      },
    },
    ...NOTIFICATION_EVENTS.map(([selector, type]) => ({
      selector,
      typeEncoding: 'v@:@',
      args: ['object'] as const,
      impl: (self: Handle) => {
        registry.get(self)?.event(type);
      },
    })),
  ]);
  return delegateClass;
};

export type WindowDelegate = {
  /** The Objective-C delegate instance to pass to `setDelegate:`. */
  readonly handle: Handle;
  /** Unregister and release the delegate instance (window teardown). */
  readonly destroy: () => void;
};

/** Create a delegate routing to `handlers`; the instance is owned +1 until `destroy()`. */
export const createWindowDelegate = (handlers: WindowDelegateHandlers): WindowDelegate => {
  const rt = cocoa();
  const cls = ensureDelegateClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(handle, handlers);
  return {
    handle,
    destroy: () => {
      registry.delete(handle);
      rt.msgSend(handle, rt.selectors.get('release'));
    },
  };
};
