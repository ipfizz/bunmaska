import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import { beep } from '../../../src/main/platform/linux/gtk-shell';

// openExternal/openPath/showItemInFolder would launch a real browser or file manager, so CI skips them.
const hasDisplay = currentPlatform() === 'linux' && loadGtkFFI().symbols.gtk_init_check() !== 0;

describe.skipIf(!hasDisplay)('Linux shell backend', () => {
  test('beep() runs on a real GDK display without throwing', () => {
    expect(() => beep()).not.toThrow();
  });
});
