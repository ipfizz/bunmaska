import { ptr } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import { type BuiltProtocolResponse, protocol } from '../../api/protocol';
import { nsString, nsStringToString } from './cocoa-foundation';
import {
  msgSendPtr,
  msgSendPtrI64,
  msgSendPtrI64Ptr,
  msgSendPtrPtrI64Ptr,
} from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import type { Handle } from './objc';

/**
 * Bridges `WKURLSchemeHandler` callbacks to the `protocol` module on macOS.
 *
 * A `WKWebView` configured (via `setURLSchemeHandler:forURLScheme:` on its
 * `WKWebViewConfiguration`) to route a custom scheme delivers each request to
 * this delegate's `webView:startURLSchemeTask:`. We read the task's request URL,
 * ask {@link protocol.dispatch} for the bytes + MIME type to serve, build an
 * `NSData` + `NSURLResponse`, and drive the task through
 * `didReceiveResponse:` → `didReceiveData:` → `didFinish`. We serve
 * synchronously, so `webView:stopURLSchemeTask:` is a no-op (it MUST still exist
 * — WebKit requires both selectors of the protocol).
 *
 * The class is defined once at runtime via {@link defineObjcClass} (D026); its
 * IMP `JSCallback`s are retained for the process lifetime by the runtime-class
 * helper's `retainedCallbacks`, so they are NEVER freed inside their own
 * invocation (the JSCallback-lifecycle discipline that prevents the SIGSEGV).
 *
 * `NSData dataWithBytes:length:` COPIES the source bytes, so the pinned buffer
 * need only outlive that one call — no long-lived pinning across the task.
 */

const log = createLogger('macos-url-scheme-handler');

/** The Bunmaska error domain for a failed custom-scheme task. */
const ERROR_DOMAIN = 'BunmaskaProtocol';
/** `NSURLErrorResourceUnavailable`-ish code for an unhandled/declined request. */
const ERROR_CODE_NO_HANDLER = -1100n;

/**
 * The dispatcher the IMP calls to serve a URL. Defaults to the live
 * {@link protocol.dispatch}; overridable for unit tests so the build/serve path
 * can be exercised without a real `WKURLSchemeTask`.
 */
let dispatcher: (url: string) => BuiltProtocolResponse | undefined = protocol.dispatch;

/** Override the URL dispatcher. Test-only. */
export const setUrlSchemeDispatcherForTesting = (
  fake: ((url: string) => BuiltProtocolResponse | undefined) | undefined,
): void => {
  dispatcher = fake ?? protocol.dispatch;
};

/** Read the absolute string of a `WKURLSchemeTask`'s request URL. */
const requestUrlOf = (task: Handle): string => {
  const rt = cocoa();
  const request = rt.msgSend(task, rt.selectors.get('request'));
  if (request === 0n) {
    return '';
  }
  const url = rt.msgSend(request, rt.selectors.get('URL'));
  if (url === 0n) {
    return '';
  }
  return nsStringToString(rt.msgSend(url, rt.selectors.get('absoluteString')));
};

/** Build an `NSURL` from a string for the response's URL field. */
const nsUrl = (url: string): Handle => {
  const rt = cocoa();
  return msgSendPtr(rt.classes.get('NSURL'), rt.selectors.get('URLWithString:'), nsString(url));
};

/**
 * Fail `task` with an `NSError` (no registered handler / declined / empty body).
 * Best-effort: a task that WebKit has already finished/stopped throws on a
 * second response, so swallow.
 */
const failTask = (task: Handle): void => {
  try {
    const rt = cocoa();
    const error = msgSendPtrI64Ptr(
      rt.classes.get('NSError'),
      rt.selectors.get('errorWithDomain:code:userInfo:'),
      nsString(ERROR_DOMAIN),
      ERROR_CODE_NO_HANDLER,
      0n,
    );
    msgSendPtr(task, rt.selectors.get('didFailWithError:'), error);
  } catch (caught) {
    log.warn('failTask: didFailWithError: threw', caught);
  }
};

/**
 * Serve `built` to `task`: build an `NSData` from the bytes and an
 * `NSURLResponse` for `url`, then drive the task through
 * `didReceiveResponse:` → `didReceiveData:` → `didFinish`.
 */
const serveTask = (task: Handle, url: string, built: BuiltProtocolResponse): void => {
  const rt = cocoa();
  // NSData dataWithBytes:length: copies, so `bytes` only needs to outlive this
  // call — no long-lived pinning. A zero-length body still produces a valid
  // (empty) NSData.
  const bytes = built.bytes;
  const dataPtr = bytes.length === 0 ? 0n : BigInt(ptr(bytes));
  const data = msgSendPtrI64(
    rt.classes.get('NSData'),
    rt.selectors.get('dataWithBytes:length:'),
    dataPtr,
    BigInt(bytes.length),
  );

  const response = msgSendPtrPtrI64Ptr(
    rt.msgSend(rt.classes.get('NSURLResponse'), rt.selectors.get('alloc')),
    rt.selectors.get('initWithURL:MIMEType:expectedContentLength:textEncodingName:'),
    nsUrl(url),
    nsString(built.mimeType),
    BigInt(bytes.length),
    nsString('utf-8'),
  );

  msgSendPtr(task, rt.selectors.get('didReceiveResponse:'), response);
  msgSendPtr(task, rt.selectors.get('didReceiveData:'), data);
  rt.msgSend(task, rt.selectors.get('didFinish'));
};

/**
 * @internal The body of `webView:startURLSchemeTask:`, factored out so the
 * serve/fail decision is exercised directly by integration tests. Reads the
 * request URL, dispatches it, and either serves the bytes or fails the task.
 * Never throws out into the IMP (any error fails the task instead).
 */
export const handleStartTask = (task: Handle): void => {
  try {
    const url = requestUrlOf(task);
    const built = dispatcher(url);
    if (built === undefined) {
      failTask(task);
      return;
    }
    serveTask(task, url, built);
  } catch (caught) {
    log.warn('startURLSchemeTask: handler threw; failing the task', caught);
    failTask(task);
  }
};

let handlerClass: Handle | undefined;

const ensureHandlerClass = (): Handle => {
  if (handlerClass !== undefined) {
    return handlerClass;
  }
  handlerClass = defineObjcClass('BunmaskaURLSchemeHandler', 'NSObject', [
    {
      selector: 'webView:startURLSchemeTask:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      // (self, _cmd, webView, task) — the task is the 2nd declared arg.
      impl: (_self, _cmd, _webView, task) => {
        handleStartTask(task);
      },
    },
    {
      selector: 'webView:stopURLSchemeTask:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      // We serve synchronously, so there is nothing to cancel — but the selector
      // MUST exist or WebKit refuses the handler (the protocol requires both).
      impl: () => undefined,
    },
  ]);
  return handlerClass;
};

/** A `WKURLSchemeHandler` instance to set on a `WKWebViewConfiguration`. */
export type UrlSchemeHandler = {
  /** The Objective-C handler instance for `setURLSchemeHandler:forURLScheme:`. */
  readonly handle: Handle;
};

/**
 * Create a shared `WKURLSchemeHandler` instance. The instance routes every
 * scheme through {@link protocol.dispatch}, so one instance serves all
 * registered schemes on a given configuration.
 */
export const createUrlSchemeHandler = (): UrlSchemeHandler => {
  const rt = cocoa();
  const cls = ensureHandlerClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  return { handle };
};
