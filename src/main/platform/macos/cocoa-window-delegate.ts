import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { WindowEventType } from '../native';
import type { Handle } from './objc';

/**
 * Bridges `NSWindowDelegate` notifications to JS.
 *
 * AppKit reports a window's lifecycle (key/resign, resize, miniaturize, close)
 * to its delegate. We define that class once at runtime (D026), allocate one
 * instance per window, and route each instance's callbacks to its registered JS
 * handlers by keying on the `self` handle delivered to the IMP — the same
 * mechanism proven for the navigation + script-message delegates.
 *
 * The IMP `JSCallback`s are retained for the process lifetime by
 * {@link defineObjcClass} (the runtime keeps the class forever), so they are
 * NEVER closed inside their own invocation — matching the JSCallback-lifetime
 * discipline of `cocoa-navigation-delegate.ts` / `gtk-signals.ts`.
 *
 * CLOSE PATH (the use-after-free fix): `windowShouldClose:` consults the JS
 * veto (returning 0 to keep the window open); `windowWillClose:` runs the
 * window's teardown on EVERY close path — title-bar red button, programmatic
 * `-close`, and `app.quit()` — so a post-close `executeJavaScript` can never
 * touch a freed `WKWebView`.
 */

/** The per-window JS handlers an `NSWindowDelegate` routes notifications to. */
export type WindowDelegateHandlers = {
  /** Return `true` to VETO the close (windowShouldClose: returns NO). */
  readonly shouldClose: () => boolean;
  /** Run AFTER AppKit has committed to closing (windowWillClose:). */
  readonly willClose: () => void;
  /** A non-preventable lifecycle event fired. */
  readonly event: (type: WindowEventType) => void;
};

const registry = new Map<Handle, WindowDelegateHandlers>();

let delegateClass: Handle | undefined;

/**
 * Map of `NSWindowDelegate` notification selectors to the lifecycle event they
 * surface. `windowShouldClose:`/`windowWillClose:` are handled separately
 * because they are preventable / teardown-bearing, not plain events.
 */
const NOTIFICATION_EVENTS: ReadonlyArray<readonly [selector: string, type: WindowEventType]> = [
  ['windowDidBecomeKey:', 'focus'],
  ['windowDidResignKey:', 'blur'],
  ['windowDidResize:', 'resize'],
  ['windowDidMiniaturize:', 'minimize'],
  ['windowDidDeminiaturize:', 'restore'],
];

const ensureDelegateClass = (): Handle => {
  if (delegateClass !== undefined) {
    return delegateClass;
  }
  delegateClass = defineObjcClass('SambarWindowDelegate', 'NSObject', [
    // windowShouldClose: returns a BOOL — return 0 (NO) to veto, 1 (YES) to
    // allow. The runtime-class IMP returns void, so the veto is routed through a
    // dedicated u8-returning method registered below by overriding buildCallback;
    // here we record the veto decision via the registry and the BOOL IMP reads
    // it. To keep a single registration path, `windowShouldClose:` is added as a
    // value-returning method by `defineObjcClass` via its `returns` extension.
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
        // shouldClose() returns true to VETO; windowShouldClose: returns NO(0) to
        // veto. Invert.
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
};

/**
 * Create an `NSWindowDelegate` instance routing notifications to `handlers`.
 * Set it as the window's delegate via `setDelegate:`. The instance is retained
 * by the registry for the window's lifetime.
 */
export const createWindowDelegate = (handlers: WindowDelegateHandlers): WindowDelegate => {
  const rt = cocoa();
  const cls = ensureDelegateClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(handle, handlers);
  return { handle };
};
