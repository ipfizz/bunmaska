import { ptr } from 'bun:ffi';
import { createLogger } from '../../../common/logger';
import type { BuiltProtocolResponse, NativeProtocol } from '../native';
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

const log = createLogger('macos-url-scheme-handler');

const ERROR_DOMAIN = 'BunmaskaProtocol';
const ERROR_CODE_NO_HANDLER = -1100n; // NSURLErrorFileDoesNotExist

let dispatcher: NativeProtocol['dispatch'] = () => undefined;

/** Fail `task` as declined. The catch covers JS/FFI errors only; an NSException aborts. */
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

const serveTask = (task: Handle, url: Handle, built: BuiltProtocolResponse): void => {
  const rt = cocoa();
  // dataWithBytes:length: copies, so `bytes` only has to outlive this call.
  const bytes = built.bytes;
  const dataPtr = bytes.length === 0 ? 0n : BigInt(ptr(bytes));
  const data = msgSendPtrI64(
    rt.classes.get('NSData'),
    rt.selectors.get('dataWithBytes:length:'),
    dataPtr,
    BigInt(bytes.length),
  );

  // NSURLResponse keeps MIMEType verbatim; a `; charset=x` suffix belongs in the encoding.
  const [mimeType = '', ...params] = built.mimeType.split(';').map((part) => part.trim());
  const charset = params
    .find((p) => /^charset=/i.test(p))
    ?.slice(8)
    .replaceAll('"', '');
  const response = msgSendPtrPtrI64Ptr(
    rt.msgSend(rt.classes.get('NSURLResponse'), rt.selectors.get('alloc')),
    rt.selectors.get('initWithURL:MIMEType:expectedContentLength:textEncodingName:'),
    url,
    nsString(mimeType),
    BigInt(bytes.length),
    nsString(charset || 'utf-8'),
  );

  msgSendPtr(task, rt.selectors.get('didReceiveResponse:'), response);
  rt.msgSend(response, rt.selectors.get('release'));
  msgSendPtr(task, rt.selectors.get('didReceiveData:'), data);
  rt.msgSend(task, rt.selectors.get('didFinish'));
};

/** @internal `webView:startURLSchemeTask:`; never throws into the IMP, any error fails the task. */
export const handleStartTask = (task: Handle, dispatch: NativeProtocol['dispatch']): void => {
  try {
    const rt = cocoa();
    const url = rt.msgSend(rt.msgSend(task, rt.selectors.get('request')), rt.selectors.get('URL'));
    const built = dispatch(nsStringToString(rt.msgSend(url, rt.selectors.get('absoluteString'))));
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
      impl: (_self, _cmd, _webView, task) => {
        handleStartTask(task, dispatcher);
      },
    },
    {
      selector: 'webView:stopURLSchemeTask:',
      typeEncoding: 'v@:@@',
      args: ['object', 'object'],
      // Tasks finish synchronously, but WebKit rejects a handler without this selector.
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

let shared: UrlSchemeHandler | undefined;

/** The process-wide handler every configuration shares; `dispatch` replaces the previous one. */
export const createUrlSchemeHandler = (dispatch: NativeProtocol['dispatch']): UrlSchemeHandler => {
  dispatcher = dispatch;
  if (shared === undefined) {
    const rt = cocoa();
    const alloc = rt.msgSend(ensureHandlerClass(), rt.selectors.get('alloc'));
    shared = { handle: rt.msgSend(alloc, rt.selectors.get('init')) };
  }
  return shared;
};
