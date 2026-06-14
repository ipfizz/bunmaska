import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { msgSendReturnsU8 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';
import { defineObjcClass } from '../../../src/main/platform/macos/cocoa-runtime-class';

if (currentPlatform() === 'macos') {
  describe('defineObjcClass', () => {
    test('creates a registered subclass of NSObject', () => {
      expect(defineObjcClass('BunmaskaTestClassA', 'NSObject', [])).not.toBe(0n);
    });

    test('an instance can be allocated and initialized', () => {
      const rt = cocoa();
      const cls = defineObjcClass('BunmaskaTestClassB', 'NSObject', []);
      const instance = rt.msgSend(
        rt.msgSend(cls, rt.selectors.get('alloc')),
        rt.selectors.get('init'),
      );
      expect(instance).not.toBe(0n);
    });

    test('an added method fires its JSCallback when the selector is sent', () => {
      const rt = cocoa();
      let fired = 0;
      const cls = defineObjcClass('BunmaskaTestClassC', 'NSObject', [
        {
          selector: 'bunmaskaPing',
          typeEncoding: 'v@:',
          args: [],
          impl: () => {
            fired += 1;
          },
        },
      ]);
      const instance = rt.msgSend(
        rt.msgSend(cls, rt.selectors.get('alloc')),
        rt.selectors.get('init'),
      );
      rt.msgSend(instance, rt.selectors.get('bunmaskaPing'));
      expect(fired).toBe(1);
    });

    test('a BOOL-returning method returns its impl value to the caller', () => {
      const rt = cocoa();
      const cls = defineObjcClass('BunmaskaTestClassBool', 'NSObject', [
        {
          selector: 'bunmaskaShouldYes',
          typeEncoding: 'c@:',
          args: [],
          returns: 'bool',
          impl: () => 1,
        },
        {
          selector: 'bunmaskaShouldNo',
          typeEncoding: 'c@:',
          args: [],
          returns: 'bool',
          impl: () => 0,
        },
      ]);
      const instance = rt.msgSend(
        rt.msgSend(cls, rt.selectors.get('alloc')),
        rt.selectors.get('init'),
      );
      expect(msgSendReturnsU8(instance, rt.selectors.get('bunmaskaShouldYes'))).toBe(1);
      expect(msgSendReturnsU8(instance, rt.selectors.get('bunmaskaShouldNo'))).toBe(0);
    });
  });
}
