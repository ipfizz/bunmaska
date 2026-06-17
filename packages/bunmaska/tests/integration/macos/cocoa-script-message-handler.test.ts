import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createScriptMessageHandler } from '../../../src/main/platform/macos/cocoa-script-message-handler';

if (currentPlatform() === 'macos') {
  describe('createScriptMessageHandler', () => {
    test('returns a non-null handler instance handle', () => {
      expect(createScriptMessageHandler(() => undefined).handle).not.toBe(0n);
    });

    test('distinct handlers get distinct instance handles', () => {
      const a = createScriptMessageHandler(() => undefined);
      const b = createScriptMessageHandler(() => undefined);
      expect(a.handle).not.toBe(b.handle);
    });
  });
}
