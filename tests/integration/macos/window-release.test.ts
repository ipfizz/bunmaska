import { describe, expect, test } from 'bun:test';
import { currentPlatform } from '../../../src/common/platform';
import { createMacOSApplication } from '../../../src/main/platform/macos/cocoa-backend';
import { cocoa } from '../../../src/main/platform/macos/cocoa-runtime';

const liveWindowCount = (): bigint => {
  const rt = cocoa();
  const app = rt.msgSend(rt.classes.get('NSApplication'), rt.selectors.get('sharedApplication'));
  return rt.msgSend(rt.msgSend(app, rt.selectors.get('windows')), rt.selectors.get('count'));
};

describe.skipIf(currentPlatform() !== 'macos')('closed windows are freed', () => {
  test('a shown then closed window leaves the NSApp window list', async () => {
    const app = createMacOSApplication();
    app.start();
    try {
      await Bun.sleep(100);
      const before = liveWindowCount();
      const win = app.createWindow({ width: 320, height: 240, title: 'release', show: true });
      await Bun.sleep(200);
      expect(liveWindowCount()).toBe(before + 1n);
      win.close();
      const deadline = performance.now() + 3_000;
      while (liveWindowCount() > before && performance.now() < deadline) {
        await Bun.sleep(50);
      }
      expect(liveWindowCount()).toBe(before);
    } finally {
      app.quit();
    }
  }, 10_000);
});
