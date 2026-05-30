import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  buildAlert,
  buildOpenPanel,
  buildSavePanel,
} from '../../../src/main/platform/macos/cocoa-dialog';

/**
 * Only the non-blocking *build* steps are tested. The *run* steps call
 * `runModal`, which spins a nested modal loop and cannot run on a headless CI
 * display, so they are exercised in real apps rather than here.
 */
if (currentPlatform() === 'macos') {
  describe('cocoa-dialog build steps', () => {
    test('buildAlert returns a non-null NSAlert', () => {
      const alert = buildAlert({ message: 'Hi', detail: 'There', buttons: ['OK', 'Cancel'] });
      expect(alert).not.toBe(0n);
    });

    test('buildAlert tolerates an empty button list', () => {
      const alert = buildAlert({ message: 'Hi', detail: '', buttons: [] });
      expect(alert).not.toBe(0n);
    });

    test('buildOpenPanel returns a non-null NSOpenPanel for files', () => {
      const panel = buildOpenPanel({
        canChooseFiles: true,
        canChooseDirectories: false,
        allowsMultipleSelection: false,
      });
      expect(panel).not.toBe(0n);
    });

    test('buildOpenPanel configures a directory multi-select panel without crashing', () => {
      const panel = buildOpenPanel({
        canChooseFiles: false,
        canChooseDirectories: true,
        allowsMultipleSelection: true,
      });
      expect(panel).not.toBe(0n);
    });

    test('buildSavePanel returns a non-null NSSavePanel', () => {
      expect(buildSavePanel({ defaultName: 'untitled.txt' })).not.toBe(0n);
    });

    test('buildSavePanel tolerates an empty default name', () => {
      expect(buildSavePanel({ defaultName: '' })).not.toBe(0n);
    });
  });
}
