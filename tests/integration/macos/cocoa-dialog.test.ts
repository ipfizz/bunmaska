import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import {
  alertStyleForType,
  buildAlert,
  buildOpenPanel,
  buildSavePanel,
} from '../../../src/main/platform/macos/cocoa-dialog';
import { msgSendReturnsI64 } from '../../../src/main/platform/macos/cocoa-msgsend-variants';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

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

    test('alertStyleForType maps Electron severities to NSAlertStyle', () => {
      expect(alertStyleForType('info')).toBe(1n);
      expect(alertStyleForType('question')).toBe(1n);
      expect(alertStyleForType('warning')).toBe(0n);
      expect(alertStyleForType('error')).toBe(2n);
      expect(alertStyleForType('none')).toBeUndefined();
      expect(alertStyleForType(undefined)).toBeUndefined();
    });

    test('buildAlert applies the alert style; AppKit reports it back', () => {
      const alert = buildAlert({ message: 'Boom', detail: '', buttons: ['OK'], type: 'error' });
      // NSAlertStyleCritical === 2.
      expect(msgSendReturnsI64(alert, cocoa().selectors.get('alertStyle'))).toBe(2n);
    });

    test('buildOpenPanel returns a non-null NSOpenPanel for files', () => {
      const panel = buildOpenPanel({
        canChooseFiles: true,
        canChooseDirectories: false,
        allowsMultipleSelection: false,
        extensions: [],
      });
      expect(panel).not.toBe(0n);
    });

    test('buildOpenPanel configures a directory multi-select panel without crashing', () => {
      const panel = buildOpenPanel({
        canChooseFiles: false,
        canChooseDirectories: true,
        allowsMultipleSelection: true,
        extensions: [],
      });
      expect(panel).not.toBe(0n);
    });

    test('buildOpenPanel applies allowed file types without crashing', () => {
      const panel = buildOpenPanel({
        canChooseFiles: true,
        canChooseDirectories: false,
        allowsMultipleSelection: false,
        extensions: ['png', 'jpg'],
      });
      expect(panel).not.toBe(0n);
    });

    test('buildSavePanel returns a non-null NSSavePanel', () => {
      expect(buildSavePanel({ defaultName: 'untitled.txt', extensions: [] })).not.toBe(0n);
    });

    test('buildSavePanel tolerates an empty default name', () => {
      expect(buildSavePanel({ defaultName: '', extensions: ['md'] })).not.toBe(0n);
    });
  });
}
