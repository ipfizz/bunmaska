import { nsString, nsStringToString } from './cocoa-foundation';
import { msgSendPtr, msgSendPtrPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';

/**
 * macOS clipboard access via `NSPasteboard`.
 *
 * Plain-text read/write against the general pasteboard. `NSPasteboardTypeString`
 * is the UTI `public.utf8-plain-text`; we pass it by value rather than reading
 * the exported constant, which is simpler and stable across macOS versions.
 * Synchronous — no run-loop interaction (D020 does not apply here).
 */

const NS_PASTEBOARD_TYPE_STRING = 'public.utf8-plain-text';

const generalPasteboard = (): bigint => {
  const rt = cocoa();
  return rt.msgSend(rt.classes.get('NSPasteboard'), rt.selectors.get('generalPasteboard'));
};

/** Read the clipboard's plain-text contents, or `''` if it holds no text. */
export const readText = (): string => {
  const rt = cocoa();
  const value = msgSendPtr(
    generalPasteboard(),
    rt.selectors.get('stringForType:'),
    nsString(NS_PASTEBOARD_TYPE_STRING),
  );
  return nsStringToString(value);
};

/** Replace the clipboard's contents with `text` as plain text. */
export const writeText = (text: string): void => {
  const rt = cocoa();
  const pasteboard = generalPasteboard();
  rt.msgSend(pasteboard, rt.selectors.get('clearContents'));
  msgSendPtrPtr(
    pasteboard,
    rt.selectors.get('setString:forType:'),
    nsString(text),
    nsString(NS_PASTEBOARD_TYPE_STRING),
  );
};

/** Clear the clipboard. */
export const clear = (): void => {
  cocoa().msgSend(generalPasteboard(), cocoa().selectors.get('clearContents'));
};
