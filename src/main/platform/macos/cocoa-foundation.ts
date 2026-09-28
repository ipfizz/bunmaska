import { CString } from 'bun:ffi';
import { msgSendCStr } from './cocoa-msgsend-variants';
import { type Handle, ptrIn } from './objc';
import { cocoa } from './cocoa-runtime';

/** Create an autoreleased `NSString`: it lives until the enclosing autorelease pool drains. */
export const nsString = (value: string): Handle => {
  const rt = cocoa();
  return msgSendCStr(rt.classes.get('NSString'), rt.selectors.get('stringWithUTF8String:'), value);
};

/** Read an `NSString` back into a JS string; `''` for nil. */
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
