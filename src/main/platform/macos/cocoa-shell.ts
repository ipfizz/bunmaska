import { dlopen, FFIType } from 'bun:ffi';
import { nsString } from './cocoa-foundation';
import { msgSendPtr, msgSendPtrReturnsU8 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { macOSLibraryAccessor } from './objc';
import type { Handle } from './objc';

/**
 * Desktop integration via `NSWorkspace` and `NSBeep` — the macOS half of
 * Electron's `shell`.
 *
 * `openExternal` / `openPath` hand a URL or path to the OS, which launches the
 * default handler (browser, Finder, …) and reports whether it accepted the
 * request. `showItemInFolder` reveals a path in Finder. These have real side
 * effects (launching apps), so automated tests assert they run without crashing
 * rather than that something actually opened.
 */

const APPKIT_PATH = '/System/Library/Frameworks/AppKit.framework/AppKit';

const getNSBeep = macOSLibraryAccessor('NSBeep', () =>
  dlopen(APPKIT_PATH, { NSBeep: { args: [], returns: FFIType.void } }),
);

const sharedWorkspace = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(rt.classes.get('NSWorkspace'), rt.selectors.get('sharedWorkspace'));
};

/** Open a URL in the default application. Returns whether the OS accepted it. */
export const openExternal = (url: string): boolean => {
  const rt = cocoa();
  const nsUrl = msgSendPtr(
    rt.classes.get('NSURL'),
    rt.selectors.get('URLWithString:'),
    nsString(url),
  );
  return msgSendPtrReturnsU8(sharedWorkspace(), rt.selectors.get('openURL:'), nsUrl) === 1;
};

/** Open a file or folder path with its default application. Returns success. */
export const openPath = (path: string): boolean => {
  const rt = cocoa();
  const fileUrl = msgSendPtr(
    rt.classes.get('NSURL'),
    rt.selectors.get('fileURLWithPath:'),
    nsString(path),
  );
  return msgSendPtrReturnsU8(sharedWorkspace(), rt.selectors.get('openURL:'), fileUrl) === 1;
};

/** Reveal a file or folder in Finder, selecting it. */
export const showItemInFolder = (path: string): void => {
  const rt = cocoa();
  const fileUrl = msgSendPtr(
    rt.classes.get('NSURL'),
    rt.selectors.get('fileURLWithPath:'),
    nsString(path),
  );
  const urls = msgSendPtr(rt.classes.get('NSArray'), rt.selectors.get('arrayWithObject:'), fileUrl);
  msgSendPtr(sharedWorkspace(), rt.selectors.get('activateFileViewerSelectingURLs:'), urls);
};

/** Play the system beep. */
export const beep = (): void => {
  getNSBeep().symbols.NSBeep();
};
