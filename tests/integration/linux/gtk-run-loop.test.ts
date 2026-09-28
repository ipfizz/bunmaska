import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createLinuxDrain } from '../../../src/main/platform/linux/gtk-run-loop';

describe.skipIf(currentPlatform() !== 'linux')('createLinuxDrain', () => {
  test('drains repeatedly without throwing or blocking', () => {
    const drain = createLinuxDrain();
    expect(() => {
      for (let i = 0; i < 50; i += 1) {
        drain();
      }
    }).not.toThrow();
  });
});
