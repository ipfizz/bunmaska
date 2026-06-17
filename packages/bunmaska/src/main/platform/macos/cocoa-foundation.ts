import { CString } from 'bun:ffi';
import { msgSendCStr } from './cocoa-msgsend-variants';
import { type Handle, ptrIn } from './objc';
import { cocoa } from './cocoa-runtime';

/**
 * Bridging helpers between JS strings and Foundation `NSString` objects.
 *
 * `NSString` is the currency type for nearly every AppKit/WebKit string
 * parameter (titles, URLs, HTML, script source), so these two helpers are used
 * throughout the macOS backend.
 */

/** Create an autoreleased `NSString` from a JS string. Returns its handle. */
export const nsString = (value: string): Handle => {
  const rt = cocoa();
  return msgSendCStr(rt.classes.get('NSString'), rt.selectors.get('stringWithUTF8String:'), value);
};

/** Read an `NSString` handle back into a JS string. Returns `''` for a null handle. */
export const nsStringToString = (handle: Handle): string => {
  if (handle === 0n) {
    return '';
  }
  const rt = cocoa();
  const utf8 = rt.msgSend(handle, rt.selectors.get('UTF8String'));
  if (utf8 === 0n) {
    return '';
  }
  return new CString(ptrIn(utf8)).toString();
};
