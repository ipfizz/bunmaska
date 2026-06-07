import { nsStringToString } from './cocoa-foundation';
import { msgSendI64, msgSendReturnsI64 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * Bridges `NSApplicationDelegate` callbacks to JS (D026).
 *
 * AppKit reports app-level activation to the application's delegate. We define
 * the delegate class once at runtime, instantiate one, and route its callbacks
 * to the registered JS handlers — the same mechanism proven for the window and
 * navigation delegates.
 *
 * `applicationShouldHandleReopen:hasVisibleWindows:` is AppKit's Dock-reopen
 * hook and the source of Electron's `activate` event. The delegate object is
 * created with `alloc`/`init` (retain count +1) and never released, so it
 * outlives `NSApp` (which holds its delegate weakly).
 */

/** JS handlers an `NSApplicationDelegate` instance routes callbacks to. */
export type AppDelegateHandlers = {
  /** The app was re-activated; `hasVisibleWindows` is AppKit's flag. */
  readonly activate: (hasVisibleWindows: boolean) => void;
  /** The OS asked the app to open a URL (custom scheme / deep link). */
  readonly openUrl: (url: string) => void;
  /** The OS asked the app to open a file path (file association). */
  readonly openFile: (path: string) => void;
};

let delegateClass: Handle | undefined;
let current: AppDelegateHandlers | undefined;

const ensureDelegateClass = (): Handle => {
  if (delegateClass !== undefined) {
    return delegateClass;
  }
  delegateClass = defineObjcClass('SambarAppDelegate', 'NSObject', [
    {
      // BOOL applicationShouldHandleReopen:(id)sender hasVisibleWindows:(BOOL)flag
      selector: 'applicationShouldHandleReopen:hasVisibleWindows:',
      typeEncoding: 'c@:@c',
      args: ['object', 'object'],
      returns: 'bool',
      impl: (_self, _cmd, _sender, hasVisibleWindows) => {
        current?.activate(hasVisibleWindows === 1n);
        // Return YES so AppKit performs its default reopen behavior.
        return 1;
      },
    },
    {
      // void application:(NSApplication*)app openURLs:(NSArray<NSURL*>*)urls
      selector: 'application:openURLs:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      impl: (_self, _cmd, _app, urls) => {
        const rt = cocoa();
        const count = msgSendReturnsI64(urls, rt.selectors.get('count'));
        for (let i = 0n; i < count; i += 1n) {
          const url = msgSendI64(urls, rt.selectors.get('objectAtIndex:'), i);
          current?.openUrl(nsStringToString(rt.msgSend(url, rt.selectors.get('absoluteString'))));
        }
      },
    },
    {
      // BOOL application:(NSApplication*)app openFile:(NSString*)filename
      selector: 'application:openFile:',
      typeEncoding: 'c@:@@',
      args: ['object', 'object'],
      returns: 'bool',
      impl: (_self, _cmd, _app, filename) => {
        current?.openFile(nsStringToString(filename));
        return 1;
      },
    },
  ]);
  return delegateClass;
};

/** The Objective-C delegate instance to pass to `[NSApp setDelegate:]`. */
export type AppDelegate = {
  readonly handle: Handle;
};

/**
 * Create an `NSApplicationDelegate` instance routing callbacks to `handlers`.
 * There is one application delegate per process; the most recent handlers win.
 */
export const createAppDelegate = (handlers: AppDelegateHandlers): AppDelegate => {
  const rt = cocoa();
  const cls = ensureDelegateClass();
  current = handlers;
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  return { handle };
};
