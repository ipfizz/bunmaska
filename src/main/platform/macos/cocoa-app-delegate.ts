import { nsStringToString } from './cocoa-foundation';
import { msgSendI64, msgSendReturnsI64, msgSendReturnsU8 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/** JS handlers an `NSApplicationDelegate` instance routes callbacks to. */
export type AppDelegateHandlers = {
  /** The app was re-activated; `hasVisibleWindows` is AppKit's flag. */
  readonly activate: (hasVisibleWindows: boolean) => void;
  /** The OS asked the app to open a URL (custom scheme / deep link). */
  readonly openUrl: (url: string) => void;
  /** The OS asked the app to open a file path (file association). */
  readonly openFile: (path: string) => void;
  /** AppKit is terminating (Cmd+Q, Dock Quit, logout); the native terminate was cancelled. */
  readonly quitRequested: () => void;
};

const NS_TERMINATE_CANCEL = 0n;

let delegateClass: Handle | undefined;
let current: AppDelegateHandlers | undefined;

const ensureDelegateClass = (): Handle => {
  if (delegateClass !== undefined) {
    return delegateClass;
  }
  delegateClass = defineObjcClass('BunmaskaAppDelegate', 'NSObject', [
    {
      // BOOL applicationShouldHandleReopen:(id)sender hasVisibleWindows:(BOOL)flag
      selector: 'applicationShouldHandleReopen:hasVisibleWindows:',
      typeEncoding: 'c@:@c',
      args: ['object', 'object'],
      returns: 'bool',
      impl: (_self, _cmd, _sender, flag) => {
        // Only the low byte of a BOOL register is defined by the ABI.
        const hasVisibleWindows = (flag & 0xffn) !== 0n;
        current?.activate(hasVisibleWindows);
        return hasVisibleWindows ? 1 : 0;
      },
    },
    {
      // NSApplicationTerminateReply applicationShouldTerminate:(NSApplication*)sender
      selector: 'applicationShouldTerminate:',
      typeEncoding: 'Q@:@',
      args: ['object'],
      returns: 'object',
      // -terminate: would exit without before-quit/will-quit or window vetoes; the JS quit runs them.
      impl: () => {
        current?.quitRequested();
        return NS_TERMINATE_CANCEL as unknown as undefined;
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
          // AppKit never calls application:openFile: once openURLs: exists; split file URLs here.
          if (msgSendReturnsU8(url, rt.selectors.get('isFileURL')) === 1) {
            current?.openFile(nsStringToString(rt.msgSend(url, rt.selectors.get('path'))));
          } else {
            current?.openUrl(nsStringToString(rt.msgSend(url, rt.selectors.get('absoluteString'))));
          }
        }
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
 * Create the app delegate; the most recent `handlers` win. Its alloc/init +1 is never
 * released because `NSApp` holds its delegate weakly.
 */
export const createAppDelegate = (handlers: AppDelegateHandlers): AppDelegate => {
  const rt = cocoa();
  const cls = ensureDelegateClass();
  current = handlers;
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  return { handle };
};
