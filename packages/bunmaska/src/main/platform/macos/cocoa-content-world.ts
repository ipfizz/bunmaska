import { nsString } from './cocoa-foundation';
import { msgSendPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import type { Handle } from './objc';

/**
 * `WKContentWorld` accessors — the macOS half of context isolation.
 *
 * A `WKContentWorld` is a named JavaScript world that shares the page's DOM but
 * has its own global object. Injecting the `__bunmaska` bridge + user preload into
 * a dedicated named world (`BunmaskaPreload`) keeps them invisible to page scripts
 * (Electron `contextIsolation: true`).
 *
 * The class resolves through the normal Objective-C class cache via
 * `objc_getClass('WKContentWorld')` once `WebKit.framework` is loaded (call
 * `loadWebKit()` first). Worlds are interned by WebKit — `+worldWithName:` with
 * the same name returns the same world — and we additionally memoise the handle
 * per process so repeated injections reuse one bigint.
 */

const worldCache = new Map<string, Handle>();

/**
 * Return the named `WKContentWorld` handle, creating it on first use and caching
 * it per process. Same name → same handle. Requires `loadWebKit()` to have run.
 */
export const getContentWorld = (name: string): Handle => {
  const cached = worldCache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const rt = cocoa();
  const world = msgSendPtr(
    rt.classes.get('WKContentWorld'),
    rt.selectors.get('worldWithName:'),
    nsString(name),
  );
  // `worldWithName:` returns an autoreleased object; retain before caching so it
  // cannot dangle when the cooperative pump drains the autorelease pool. This is
  // a process-lifetime singleton, so the matching release is never needed.
  rt.msgSend(world, rt.selectors.get('retain'));
  worldCache.set(name, world);
  return world;
};

/**
 * Return the shared `+[WKContentWorld pageWorld]` (the page's main world). Used
 * immediately by callers, so it is not cached — do NOT cache the result of this
 * (or `worldWithName:`) without sending `-retain` first.
 */
export const pageWorld = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(rt.classes.get('WKContentWorld'), rt.selectors.get('pageWorld'));
};

/**
 * Return `+[WKContentWorld defaultClientWorld]` (WebKit's default client world).
 * Used immediately; do NOT cache without sending `-retain` first.
 */
export const defaultClientWorld = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(rt.classes.get('WKContentWorld'), rt.selectors.get('defaultClientWorld'));
};

/** Clear the memoised world handles. Test-only. */
export const resetContentWorldCacheForTesting = (): void => {
  worldCache.clear();
};
