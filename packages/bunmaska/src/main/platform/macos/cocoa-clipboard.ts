import { nsString, nsStringToString } from './cocoa-foundation';
import { msgSendI64, msgSendPtr, msgSendPtrPtr, msgSendReturnsI64 } from './cocoa-msgsend-variants';
import { nsDataFromBytes, nsDataToBytes } from './cocoa-native-image';
import { cocoa } from './cocoa-runtime';

/**
 * macOS clipboard access via `NSPasteboard`.
 *
 * Plain-text and HTML read/write against the general pasteboard.
 * `NSPasteboardTypeString` is the UTI `public.utf8-plain-text` and
 * `NSPasteboardTypeHTML` is `public.html`; we pass them by value rather than
 * reading the exported constants, which is simpler and stable across macOS
 * versions. Synchronous — no run-loop interaction (D020 does not apply here).
 */

const NS_PASTEBOARD_TYPE_STRING = 'public.utf8-plain-text';
const NS_PASTEBOARD_TYPE_HTML = 'public.html';
const NS_PASTEBOARD_TYPE_PNG = 'public.png';

/** Map common pasteboard UTIs to Electron-style format names; pass others through. */
const UTI_TO_FORMAT: Readonly<Record<string, string>> = {
  'public.utf8-plain-text': 'text/plain',
  'public.html': 'text/html',
  'public.png': 'image/png',
  'public.tiff': 'image/tiff',
  'public.rtf': 'text/rtf',
};

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

/** Read the clipboard's HTML markup, or `''` if it holds no HTML. */
export const readHTML = (): string => {
  const rt = cocoa();
  const value = msgSendPtr(
    generalPasteboard(),
    rt.selectors.get('stringForType:'),
    nsString(NS_PASTEBOARD_TYPE_HTML),
  );
  return nsStringToString(value);
};

/** Replace the clipboard's contents with `markup` as HTML. */
export const writeHTML = (markup: string): void => {
  const rt = cocoa();
  const pasteboard = generalPasteboard();
  rt.msgSend(pasteboard, rt.selectors.get('clearContents'));
  msgSendPtrPtr(
    pasteboard,
    rt.selectors.get('setString:forType:'),
    nsString(markup),
    nsString(NS_PASTEBOARD_TYPE_HTML),
  );
};

/** Read the clipboard's image as PNG bytes, or an empty array if it holds none. */
export const readImage = (): Uint8Array => {
  const rt = cocoa();
  const data = msgSendPtr(
    generalPasteboard(),
    rt.selectors.get('dataForType:'),
    nsString(NS_PASTEBOARD_TYPE_PNG),
  );
  return nsDataToBytes(data);
};

/** Replace the clipboard's contents with `png` (PNG-encoded image bytes). */
export const writeImage = (png: Uint8Array): void => {
  const rt = cocoa();
  const pasteboard = generalPasteboard();
  rt.msgSend(pasteboard, rt.selectors.get('clearContents'));
  msgSendPtrPtr(
    pasteboard,
    rt.selectors.get('setData:forType:'),
    nsDataFromBytes(png),
    nsString(NS_PASTEBOARD_TYPE_PNG),
  );
};

/** The format names currently on the clipboard (Electron's `availableFormats`). */
export const availableFormats = (): string[] => {
  const rt = cocoa();
  const types = rt.msgSend(generalPasteboard(), rt.selectors.get('types'));
  if (types === 0n) {
    return [];
  }
  const count = Number(msgSendReturnsI64(types, rt.selectors.get('count')));
  const formats: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const uti = nsStringToString(msgSendI64(types, rt.selectors.get('objectAtIndex:'), BigInt(i)));
    if (uti.length > 0) {
      formats.push(UTI_TO_FORMAT[uti] ?? uti);
    }
  }
  return formats;
};

/** Clear the clipboard. */
export const clear = (): void => {
  cocoa().msgSend(generalPasteboard(), cocoa().selectors.get('clearContents'));
};
