import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createLinuxDrain } from '../../../src/main/platform/linux/gtk-run-loop';

if (currentPlatform() === 'linux') {
  describe('createLinuxDrain', () => {
    test('returns a drain that runs many times without crashing', () => {
      const drain = createLinuxDrain();
      for (let i = 0; i < 50; i += 1) {
        drain();
      }
      expect(typeof drain).toBe('function');
    });
  });
}
