import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../../../src/common/platform';
import { defineObjcClass } from '../../../../../src/main/platform/macos/cocoa-runtime-class';

describe('defineObjcClass duplicate names', () => {
  test.skipIf(currentPlatform() !== 'macos')('throws for an already-registered class name', () => {
    // NSObject is always registered, so objc_allocateClassPair returns nil for
    // it; the guard turns that into an error instead of silent corruption.
    expect(() => defineObjcClass('NSObject', 'NSObject', [])).toThrow(/already registered/);
  });
});
