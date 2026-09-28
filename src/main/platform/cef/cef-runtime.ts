import { FFIType, JSCallback, type Pointer, ptr } from 'bun:ffi';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BunmaskaError } from '../../../common/errors';
import { cstr } from '../cstr';
import { dlopen } from '../dlopen';
import { cocoa } from '../macos/cocoa-runtime';
import { defineObjcClass } from '../macos/cocoa-runtime-class';
import { type Handle, LIBOBJC_PATH, macOSLibraryAccessor } from '../macos/objc';
import { sharedClient } from './cef-client';
import {
  APP,
  allocImmortal,
  BROWSER_PROCESS_HANDLER,
  CEF_API_VERSION,
  COMMAND_LINE,
  COOKIE_MANAGER,
  callMethod,
  cefLibrary,
  LOG_SEVERITY_ERROR,
  PREFERENCE_MANAGER,
  RUNTIME_STYLE_ALLOY,
  readCefString,
  release,
  retainForever,
  SETTINGS,
  SIZE,
  setPtr,
  toAddress,
  VALUE,
  WINDOW_INFO,
  writeCefString,
} from './cef-ffi';
import { cefGlue } from './cef-glue';

/** Where a CEF engine keeps its framework and generic helper apps (the engine's `lib/`). */
export const cefFrameworkPath = (libDir: string): string =>
  join(libDir, 'Chromium Embedded Framework.framework');
export const cefLibraryPath = (libDir: string): string =>
  join(cefFrameworkPath(libDir), 'Chromium Embedded Framework');
export const cefHelperPath = (libDir: string): string =>
  join(libDir, 'bunmaska Helper.app', 'Contents', 'MacOS', 'bunmaska Helper');

const objcExtras = macOSLibraryAccessor('objc super + protocols', () =>
  dlopen(LIBOBJC_PATH, {
    objc_msgSendSuper: { args: [FFIType.ptr, FFIType.u64, FFIType.u64], returns: FFIType.void },
    objc_getProtocol: { args: [FFIType.cstring], returns: FFIType.u64 },
    class_addProtocol: { args: [FFIType.u64, FFIType.u64], returns: FFIType.u8 },
    object_getClass: { args: [FFIType.u64], returns: FFIType.u64 },
    object_setClass: { args: [FFIType.u64, FFIType.u64], returns: FFIType.u64 },
  }),
);

let handlingSendEvent = false;

/**
 * Chromium requires NSApp to be an NSApplication subclass answering
 * `isHandlingSendEvent` (CrAppControlProtocol); `sendEvent:` brackets every dispatch
 * with the flag. Must run after the CEF framework is loaded (it registers the protocols).
 */
export const installCefApplicationClass = (): void => {
  const rt = cocoa();
  const objc = objcExtras();
  const superclass = rt.classes.get('NSApplication');
  const sendEventSelector = rt.selectors.get('sendEvent:');
  const objcSuper = Buffer.alloc(16);
  retainForever(objcSuper);
  const cls = defineObjcClass('BunmaskaCefApplication', 'NSApplication', [
    {
      selector: 'isHandlingSendEvent',
      typeEncoding: 'c@:',
      args: [],
      returns: 'bool',
      impl: () => (handlingSendEvent ? 1 : 0),
    },
    {
      selector: 'setHandlingSendEvent:',
      typeEncoding: 'v@:c',
      args: ['bool'],
      impl: (_self, _cmd, flag) => {
        handlingSendEvent = flag !== 0n;
      },
    },
    {
      selector: 'sendEvent:',
      typeEncoding: 'v@:@',
      args: ['object'],
      impl: (self, _cmd, event) => {
        const previous = handlingSendEvent;
        handlingSendEvent = true;
        try {
          objcSuper.writeBigUInt64LE(self, 0);
          objcSuper.writeBigUInt64LE(superclass, 8);
          objc.symbols.objc_msgSendSuper(ptr(objcSuper), sendEventSelector, event ?? 0n);
        } finally {
          handlingSendEvent = previous;
        }
      },
    },
  ]);
  for (const name of ['CrAppProtocol', 'CrAppControlProtocol']) {
    const protocol = objc.symbols.objc_getProtocol(cstr(name));
    if (protocol !== 0n) {
      objc.symbols.class_addProtocol(cls, protocol);
    }
  }
  const app = rt.msgSend(cls, rt.selectors.get('sharedApplication'));
  // An AppKit call before ready (nativeTheme.themeSource, Menu.setApplicationMenu) already
  // made a plain NSApp, which Chromium aborts on; the subclass adds no ivars, so swap in place.
  if (objc.symbols.object_getClass(app) === superclass) {
    objc.symbols.object_setClass(app, cls);
  }
};

/**
 * An unbundled process (`bun main.ts`) has no main bundle, and Chromium derives
 * the Mach rendezvous service name from it in the parent AND (via
 * `--main-bundle-path`) in every helper; without one they never meet. A packaged
 * .app already is one. The stub lives in a private per-process dir: helpers read it
 * whenever they spawn, so a shared one rewritten by another launch can be caught empty.
 */
export const mainBundlePath = (): string => {
  if (process.execPath.includes('.app/Contents/MacOS/')) {
    return '';
  }
  const dir = mkdtempSync(join(tmpdir(), 'bunmaska-cef-'));
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  const bundle = join(dir, 'DevHost.app');
  mkdirSync(join(bundle, 'Contents'), { recursive: true });
  writeFileSync(
    join(bundle, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>org.bunmaska.devhost</string>
<key>CFBundleName</key><string>bunmaska</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
  );
  return bundle;
};

/**
 * Browser-process switches asking Chrome's layer (which CEF always boots) to stay off
 * the network on its own.
 */
const CHROMIUM_SWITCHES = [
  'disable-background-networking',
  'disable-component-update',
  'disable-sync',
  'disable-default-apps',
  'disable-domain-reliability',
  'disable-client-side-phishing-detection',
  'no-first-run',
  'no-default-browser-check',
  // Chromium keeps its cookie key in a Keychain item every CEF app shares ("Chromium
  // Safe Storage"); another app's item makes ours prompt, and every HTTP load waits on it.
  'use-mock-keychain',
] as const;

/**
 * Chrome features that still call Google with the switches above (measured on CEF 154):
 * the AI Mode eligibility check (www.google.com/async/folae), network time
 * (clients2.google.com/time), the default search engine preconnect (www.google.com) and
 * Autofill's form-signature queries (content-autofill.googleapis.com, on any page with a form).
 */
const DISABLED_FEATURES = [
  'AimEnabled',
  'NetworkTimeServiceQuerying',
  'PreconnectToSearch',
  'AutofillServerCommunication',
];

/** A `cef_string_t*` for `value`; `keep` must outlive the call it is passed to. */
const cefString = (value: string, keep: unknown[]): Pointer => {
  const buf = Buffer.alloc(24);
  writeCefString(buf, 0, value, keep);
  keep.push(buf);
  return ptr(buf);
};

const appendChromiumSwitches = (commandLine: number, profile: string): void => {
  const keep: unknown[] = [];
  const call = (method: number, returns: FFIType, ...values: string[]): unknown =>
    callMethod(
      commandLine,
      method,
      values.map(() => FFIType.ptr),
      returns,
      ...values.map((value) => cefString(value, keep)),
    );
  const append = (name: string, value: string): void => {
    call(COMMAND_LINE.appendSwitchWithValue, FFIType.void, name, value);
  };
  for (const name of CHROMIUM_SWITCHES) {
    call(COMMAND_LINE.appendSwitch, FFIType.void, name);
  }
  // CEF has already disabled features of its own here, and a second value replaces them.
  const cefDisabled = toAddress(call(COMMAND_LINE.getSwitchValue, FFIType.ptr, 'disable-features'));
  append(
    'disable-features',
    [readCefString(cefDisabled), ...DISABLED_FEATURES].filter(Boolean).join(','),
  );
  if (cefDisabled !== 0) {
    cefLibrary().symbols.cef_string_userfree_utf16_free(cefDisabled as Pointer);
  }
  // The on-device AI model manifest registers with the component updater and downloads on
  // every launch, --disable-component-update or not; an empty local override skips it.
  const manifest = join(profile, 'bunmaska-model-manifest.json');
  writeFileSync(manifest, '{}');
  append('optimization-guide-manifest-override', manifest);
  // Chrome POSTs accounts.google.com/ListAccounts at every launch and no switch, feature or
  // pref stops it (CEF issue #4276); an unresolvable URL fails it before any DNS or socket.
  append('gaia-config-contents', '{"urls":{"list_accounts_url":{"url":"data:,"}}}');
};

/** Set a Local State preference. UI thread, after the context is initialized. */
const setGlobalPreference = (name: string, value: string): void => {
  const lib = cefLibrary().symbols;
  const keep: unknown[] = [];
  const cefValue = toAddress(lib.cef_value_create());
  callMethod(cefValue, VALUE.setString, [FFIType.ptr], FFIType.i32, cefString(value, keep));
  const manager = toAddress(lib.cef_preference_manager_get_global());
  const error = Buffer.alloc(24);
  // set_preference takes over our reference to the value.
  callMethod(
    manager,
    PREFERENCE_MANAGER.setPreference,
    [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    FFIType.i32,
    cefString(name, keep),
    cefValue,
    ptr(error),
  );
  release(manager);
};

export type CefInitOptions = {
  /** The CEF engine's `lib/` (framework + helper apps). */
  readonly libDir: string;
  /** The app's `userData`; Chromium's profile lives in {@link cefProfilePath} inside it. */
  readonly userDataPath: string;
};

/**
 * Chromium's profile dir, never `userData` itself: its process-singleton files are named
 * SingletonLock/SingletonSocket, like requestSingleInstanceLock's, and sharing the names
 * stalls cef_initialize ~20s on our socket, then Chromium takes over our lock.
 */
export const cefProfilePath = (userDataPath: string): string => join(userDataPath, 'Blink');

/**
 * `cef_initialize` with the external message pump: CEF asks for work through
 * the glue's scheduler, which wakes the adaptive pump that calls
 * {@link doCefWork}. The UI thread is therefore the Bun main thread.
 */
export const initializeCef = (options: CefInitOptions): void => {
  const lib = cefLibrary();
  const glue = cefGlue();
  const profile = cefProfilePath(options.userDataPath);
  // NULL = this CEF build lacks the API version; every CEF call after it is a FATAL abort.
  if (toAddress(lib.symbols.cef_api_hash(CEF_API_VERSION, 0)) === 0) {
    throw new BunmaskaError(
      `Blink engine: this CEF build does not support API ${CEF_API_VERSION}; install a CEF ${CEF_API_VERSION / 100} engine`,
      { code: 'ERR_BLINK_INIT' },
    );
  }

  let contextInitialized = false;
  const onContextInitialized = new JSCallback(
    () => {
      contextInitialized = true;
      // Chrome's default "automatic" secure DNS upgrades lookups to the system resolver's
      // DoH endpoint and probes it; plain system DNS like any other app instead.
      setGlobalPreference('dns_over_https.mode', 'off');
    },
    { args: [FFIType.ptr], returns: FFIType.void },
  );
  retainForever(onContextInitialized);
  const handler = allocImmortal(SIZE.browserProcessHandler);
  glue.initBase(handler.at, SIZE.browserProcessHandler);
  setPtr(
    handler.buf,
    BROWSER_PROCESS_HANDLER.onContextInitialized,
    toAddress(onContextInitialized.ptr),
  );
  setPtr(handler.buf, BROWSER_PROCESS_HANDLER.onScheduleMessagePumpWork, glue.scheduleFn());
  // Another process launched on this profile: unhandled (0 or NULL), Chrome opens its own
  // tabbed browser window here, outside every bunmaska policy. UI thread.
  const onRelaunch = new JSCallback(
    (_self: unknown, commandLine: unknown) => {
      release(toAddress(commandLine));
      return 1;
    },
    { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  );
  retainForever(onRelaunch);
  setPtr(
    handler.buf,
    BROWSER_PROCESS_HANDLER.onAlreadyRunningAppRelaunch,
    toAddress(onRelaunch.ptr),
  );

  const onCommandLine = new JSCallback(
    (_self: unknown, processType: unknown, commandLine: unknown) => {
      if (readCefString(toAddress(processType)) === '') {
        appendChromiumSwitches(toAddress(commandLine), profile);
      }
      release(toAddress(commandLine));
    },
    { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
  );
  retainForever(onCommandLine);
  const app = allocImmortal(SIZE.app + 8);
  glue.initBase(app.at, SIZE.app);
  setPtr(app.buf, APP.onBeforeCommandLineProcessing, toAddress(onCommandLine.ptr));
  setPtr(app.buf, APP.getBrowserProcessHandler, glue.slotGetter(0));
  setPtr(app.buf, SIZE.app, handler.at);

  const keep: unknown[] = [];
  const argv0 = cstr('bunmaska');
  const argv = Buffer.alloc(8);
  setPtr(argv, 0, ptr(argv0));
  const mainArgs = Buffer.alloc(SIZE.mainArgs);
  mainArgs.writeInt32LE(1, 0);
  setPtr(mainArgs, 8, ptr(argv));

  mkdirSync(profile, { recursive: true });
  const settings = Buffer.alloc(SIZE.settings);
  setPtr(settings, 0, SIZE.settings);
  settings.writeInt32LE(1, SETTINGS.noSandbox);
  writeCefString(settings, SETTINGS.browserSubprocessPath, cefHelperPath(options.libDir), keep);
  writeCefString(settings, SETTINGS.frameworkDirPath, cefFrameworkPath(options.libDir), keep);
  writeCefString(settings, SETTINGS.mainBundlePath, mainBundlePath(), keep);
  settings.writeInt32LE(1, SETTINGS.externalMessagePump);
  writeCefString(settings, SETTINGS.rootCachePath, profile, keep);
  writeCefString(settings, SETTINGS.cachePath, profile, keep);
  settings.writeInt32LE(LOG_SEVERITY_ERROR, SETTINGS.logSeverity);
  glue.pumpInit();
  const ok = lib.symbols.cef_initialize(ptr(mainArgs), ptr(settings), app.at, null);
  if (ok !== 1 || !contextInitialized) {
    throw new BunmaskaError(
      `Blink engine: cef_initialize failed (result ${ok}); is another instance of this app running with the same userData?`,
      { code: 'ERR_BLINK_INIT' },
    );
  }
};

/** Run the work CEF scheduled; called on every pump tick. */
export const doCefWork = (): void => {
  cefLibrary().symbols.cef_do_message_loop_work();
};

/** Ask Chromium to write its cookie store to disk now (async, fire-and-forget). */
export const flushCookies = (): void => {
  const manager = toAddress(cefLibrary().symbols.cef_cookie_manager_get_global_manager(null));
  if (manager !== 0) {
    callMethod(manager, COOKIE_MANAGER.flushStore, [FFIType.ptr], FFIType.i32, null);
    release(manager);
  }
};

/**
 * A windowed Alloy-style browser as a child of `parentView` (an NSView), starting
 * on about:blank so the DevTools session can be armed before the app's first load.
 */
export const createCefBrowser = (parentView: Handle, width: number, height: number): number => {
  const keep: unknown[] = [];
  const windowInfo = Buffer.alloc(SIZE.windowInfo);
  setPtr(windowInfo, 0, SIZE.windowInfo);
  windowInfo.writeInt32LE(width, WINDOW_INFO.bounds + 8);
  windowInfo.writeInt32LE(height, WINDOW_INFO.bounds + 12);
  setPtr(windowInfo, WINDOW_INFO.parentView, parentView);
  windowInfo.writeInt32LE(RUNTIME_STYLE_ALLOY, WINDOW_INFO.runtimeStyle);
  const browserSettings = Buffer.alloc(SIZE.browserSettings);
  setPtr(browserSettings, 0, SIZE.browserSettings);
  const url = Buffer.alloc(24);
  writeCefString(url, 0, 'about:blank', keep);
  const browser = toAddress(
    cefLibrary().symbols.cef_browser_host_create_browser_sync(
      ptr(windowInfo),
      sharedClient(),
      ptr(url),
      ptr(browserSettings),
      null,
      null,
    ),
  );
  if (browser === 0) {
    throw new BunmaskaError('Blink engine: CEF refused to create a browser', {
      code: 'ERR_BLINK_BROWSER',
    });
  }
  return browser;
};
