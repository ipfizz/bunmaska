import { CFunction, FFIType, read } from 'bun:ffi';
import { dlopen } from '../dlopen';
import { makeOneShotBlock } from './cocoa-block';
import { buildAlert, buildOpenPanel } from './cocoa-dialog';
import { nsStringToString } from './cocoa-foundation';
import { msgSendPtrPtr, msgSendReturnsU8 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import { defineObjcClass } from './cocoa-runtime-class';
import { type Handle, macOSLibraryAccessor, ptrIn } from './objc';

/**
 * Bridges `WKUIDelegate` to JS (D026): window.open, alert, confirm and `<input type=file>`.
 * `prompt()` stays unimplemented, so WebKit returns null, matching Electron's unsupported prompt.
 */

const NS_MODAL_RESPONSE_CANCEL = 0n;
const NS_MODAL_RESPONSE_OK = 1n;
const NS_ALERT_FIRST_BUTTON_RETURN = 1000n;

const registry = new Map<Handle, (url: string) => void>();

let delegateClass: Handle | undefined;

const blockRuntime = macOSLibraryAccessor('libSystem blocks', () =>
  dlopen('/usr/lib/libSystem.B.dylib', {
    _Block_copy: { args: [FFIType.u64], returns: FFIType.u64 },
    _Block_release: { args: [FFIType.u64], returns: FFIType.void },
  }),
);

/**
 * Copy WebKit's completion block and return a one-shot caller for it. WebKit raises an
 * uncatchable NSException if the block is freed uncalled, so every path must call the reply.
 */
const holdReply = (
  block: Handle,
  argTypes: FFIType[],
): ((...args: (number | bigint)[]) => void) => {
  const blocks = blockRuntime().symbols;
  const held = blocks._Block_copy(block);
  return (...args) => {
    // A Block's invoke pointer lives at offset 16 and takes the block itself first (D022b).
    const invoke = CFunction({
      ptr: read.u64(ptrIn(held), 16),
      args: [FFIType.u64, ...argTypes],
      returns: FFIType.void,
    });
    try {
      invoke(held, ...args);
    } finally {
      invoke.close();
      blocks._Block_release(held);
    }
  };
};

/** Show `sheet` (+1, consumed) on the web view's window; with no window, `onEnd` gets cancel. */
const runSheet = (webView: Handle, sheet: Handle, onEnd: (response: bigint) => void): void => {
  const rt = cocoa();
  const release = (): void => {
    rt.msgSend(sheet, rt.selectors.get('release'));
  };
  const window = rt.msgSend(webView, rt.selectors.get('window'));
  if (window === 0n) {
    release();
    onEnd(NS_MODAL_RESPONSE_CANCEL);
    return;
  }
  const done = makeOneShotBlock(
    (response) => {
      onEnd(BigInt(response ?? 0));
      // AppKit is still inside the sheet's own method here; release on a later tick.
      setTimeout(release, 0);
    },
    [FFIType.i64],
  );
  msgSendPtrPtr(
    sheet,
    rt.selectors.get('beginSheetModalForWindow:completionHandler:'),
    window,
    done,
  );
};

const messageAlert = (message: Handle, buttons: string[]): Handle =>
  buildAlert({ message: nsStringToString(message), detail: '', buttons });

const ensureDelegateClass = (): Handle => {
  if (delegateClass !== undefined) {
    return delegateClass;
  }
  delegateClass = defineObjcClass('BunmaskaUIDelegate', 'NSObject', [
    {
      selector: 'webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:',
      typeEncoding: '@@:@@@@',
      args: ['object', 'object', 'object', 'object'],
      returns: 'object',
      impl: (self, _cmd, _webView, _config, navigationAction) => {
        const handler = registry.get(self);
        if (handler !== undefined) {
          const rt = cocoa();
          const request = rt.msgSend(navigationAction, rt.selectors.get('request'));
          const url = request === 0n ? 0n : rt.msgSend(request, rt.selectors.get('URL'));
          handler(
            url === 0n ? '' : nsStringToString(rt.msgSend(url, rt.selectors.get('absoluteString'))),
          );
        }
        // nil: no child web view; the app opens the URL from its handler.
        return 0n; // ponytail: deny-only, allowing needs a child BrowserWindow
      },
    },
    {
      selector: 'webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:',
      typeEncoding: 'v@:@@@@?',
      args: ['object', 'object', 'object', 'object'],
      impl: (_self, _cmd, webView, message, _frame, completion) => {
        const reply = holdReply(completion, []);
        runSheet(webView, messageAlert(message, ['OK']), () => reply());
      },
    },
    {
      selector: 'webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:',
      typeEncoding: 'v@:@@@@?',
      args: ['object', 'object', 'object', 'object'],
      impl: (_self, _cmd, webView, message, _frame, completion) => {
        const reply = holdReply(completion, [FFIType.u8]);
        runSheet(webView, messageAlert(message, ['OK', 'Cancel']), (response) =>
          reply(response === NS_ALERT_FIRST_BUTTON_RETURN ? 1 : 0),
        );
      },
    },
    {
      selector: 'webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:',
      typeEncoding: 'v@:@@@@?',
      args: ['object', 'object', 'object', 'object'],
      impl: (_self, _cmd, webView, parameters, _frame, completion) => {
        const rt = cocoa();
        const reply = holdReply(completion, [FFIType.u64]);
        const flag = (name: string): boolean =>
          msgSendReturnsU8(parameters, rt.selectors.get(name)) === 1;
        const panel = buildOpenPanel({
          canChooseFiles: true,
          canChooseDirectories: flag('allowsDirectories'),
          allowsMultipleSelection: flag('allowsMultipleSelection'),
          canCreateDirectories: false,
          defaultPath: '',
          extensions: [],
        });
        rt.msgSend(panel, rt.selectors.get('retain'));
        runSheet(webView, panel, (response) =>
          reply(
            response === NS_MODAL_RESPONSE_OK ? rt.msgSend(panel, rt.selectors.get('URLs')) : 0n,
          ),
        );
      },
    },
  ]);
  return delegateClass;
};

export type UIDelegate = {
  /** The Objective-C delegate instance to pass to `setUIDelegate:`. */
  readonly handle: Handle;
  /** Unregister and release the delegate instance (window teardown). */
  readonly destroy: () => void;
};

/** Create a `WKUIDelegate` whose window-open requests call `onWindowOpen(url)`. */
export const createUIDelegate = (onWindowOpen: (url: string) => void): UIDelegate => {
  const rt = cocoa();
  const cls = ensureDelegateClass();
  const handle = rt.msgSend(rt.msgSend(cls, rt.selectors.get('alloc')), rt.selectors.get('init'));
  registry.set(handle, onWindowOpen);
  return {
    handle,
    destroy: () => {
      registry.delete(handle);
      rt.msgSend(handle, rt.selectors.get('release'));
    },
  };
};
