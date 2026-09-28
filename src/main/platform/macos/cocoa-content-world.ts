import { nsString } from './cocoa-foundation';
import { msgSendPtr } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import type { Handle } from './objc';

/** `WKContentWorld` accessors for context isolation. Call `loadWebKit()` first. */

const worldCache = new Map<string, Handle>();

/** The named world, retained and cached for the process lifetime. */
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
  // Never cache an autoreleased world without -retain: the pump drains the pool and
  // the cached handle dangles. Process-lifetime, so it is never released.
  rt.msgSend(world, rt.selectors.get('retain'));
  worldCache.set(name, world);
  return world;
};

/** The page's main world; autoreleased, so use it immediately (see the retain rule above). */
export const pageWorld = (): Handle => {
  const rt = cocoa();
  return rt.msgSend(rt.classes.get('WKContentWorld'), rt.selectors.get('pageWorld'));
};
