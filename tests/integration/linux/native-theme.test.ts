import { describe, expect, test } from 'bun:test';
import { dlopen, FFIType } from 'bun:ffi';
import { currentPlatform } from '../../../src/common/platform';
import { cstr } from '../../../src/main/platform/cstr';
import { loadGtkFFI } from '../../../src/main/platform/linux/gtk-ffi';
import {
  observeAppearanceChange,
  shouldUseDarkColors,
} from '../../../src/main/platform/linux/gtk-native-theme';

const hasDisplay = currentPlatform() === 'linux' && loadGtkFFI().symbols.gtk_init_check() !== 0;

/** g_object_set pinned to one gboolean property (the backend only reads it). */
const setPreferDark = (value: 0 | 1): void => {
  const settings = loadGtkFFI().symbols.gtk_settings_get_default();
  if (settings === null) {
    throw new Error('gtk_settings_get_default returned null');
  }
  dlopen('libgobject-2.0.so.0', {
    g_object_set: {
      args: [FFIType.pointer, FFIType.cstring, FFIType.i32, FFIType.pointer],
      returns: FFIType.void,
    },
  }).symbols.g_object_set(settings, cstr('gtk-application-prefer-dark-theme'), value, null);
};

describe.skipIf(!hasDisplay)('gtk-native-theme', () => {
  test('shouldUseDarkColors follows prefer-dark and the observer fires on the flip', () => {
    setPreferDark(0);
    let notified = 0;
    observeAppearanceChange(() => {
      notified += 1;
    });
    try {
      setPreferDark(1);
      expect(shouldUseDarkColors()).toBe(true);
      expect(notified).toBeGreaterThan(0);
      setPreferDark(0);
      expect(shouldUseDarkColors()).toBe(false);
    } finally {
      setPreferDark(0);
    }
  });
});
