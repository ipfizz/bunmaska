import { read } from 'bun:ffi';
import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendU8 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { dataSymbolAddress } from '../../../src/main/platform/macos/objc';

const CORE_FOUNDATION = '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation';

describe.skipIf(currentPlatform() !== 'macos')('dataSymbolAddress', () => {
  test('resolves a data global to its address', () => {
    const rt = cocoa();
    const yes = msgSendU8(rt.classes.get('NSNumber'), rt.selectors.get('numberWithBool:'), 1);
    expect(read.u64(dataSymbolAddress(CORE_FOUNDATION, 'kCFBooleanTrue'), 0)).toBe(yes);
  });
});
