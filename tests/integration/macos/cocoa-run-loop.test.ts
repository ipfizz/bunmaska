import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  createMacOSDrain,
  withAutoreleasePool,
} from '../../../src/main/platform/macos/cocoa-run-loop';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

const newObject = (): bigint => {
  const rt = cocoa();
  return rt.msgSend(
    rt.msgSend(rt.classes.get('NSObject'), rt.selectors.get('alloc')),
    rt.selectors.get('init'),
  );
};

const retainCount = (handle: bigint): bigint =>
  cocoa().msgSend(handle, cocoa().selectors.get('retainCount'));

const retainAutorelease = (handle: bigint): void => {
  const rt = cocoa();
  rt.msgSend(rt.msgSend(handle, rt.selectors.get('retain')), rt.selectors.get('autorelease'));
};

describe.skipIf(currentPlatform() !== 'macos')('createMacOSDrain', () => {
  test('each tick of any drain releases what JS autoreleased since the last tick', () => {
    const first = createMacOSDrain();
    const second = createMacOSDrain();
    const object = newObject();
    try {
      for (const drain of [first, second, first, second]) {
        retainAutorelease(object);
        expect(retainCount(object)).toBe(2n);
        drain(0);
        expect(retainCount(object)).toBe(1n);
      }
    } finally {
      cocoa().msgSend(object, cocoa().selectors.get('release'));
    }
  });

  test('withAutoreleasePool releases what its callback autoreleased and returns its value', () => {
    const object = newObject();
    try {
      const count = withAutoreleasePool(() => {
        retainAutorelease(object);
        return retainCount(object);
      });
      expect(count).toBe(2n);
      expect(retainCount(object)).toBe(1n);
    } finally {
      cocoa().msgSend(object, cocoa().selectors.get('release'));
    }
  });
});
