import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app } from '../../../../src/main/api/app';
import { Menu } from '../../../../src/main/api/menu';
import { setTrayBackendForTesting, Tray, type TrayImage } from '../../../../src/main/api/tray';
import type {
  TrayBackend,
  TrayImageOptions,
  TrayInstance,
} from '../../../../src/main/platform/services';

type FakeInstance = TrayInstance & {
  readonly image: string;
  toolTips: string[];
  titles: string[];
  images: string[];
  menus: Array<Menu | null>;
  destroyed: boolean;
  click: (() => void) | undefined;
};

let created: FakeInstance[];

const makeInstance = (image: string): FakeInstance => {
  const instance: FakeInstance = {
    image,
    toolTips: [],
    titles: [],
    images: [],
    menus: [],
    destroyed: false,
    click: undefined,
    setToolTip: (toolTip) => {
      instance.toolTips.push(toolTip);
    },
    setTitle: (title) => {
      instance.titles.push(title);
    },
    setImage: (img) => {
      instance.images.push(img);
    },
    setContextMenu: (menu) => {
      instance.menus.push(menu);
    },
    onClick: (cb) => {
      instance.click = cb;
    },
    destroy: () => {
      instance.destroyed = true;
    },
    isDestroyed: () => instance.destroyed,
  };
  return instance;
};

let createOptions: (TrayImageOptions | undefined)[] = [];
let createAppNames: (string | undefined)[] = [];

beforeEach(() => {
  created = [];
  createOptions = [];
  createAppNames = [];
  const fake: TrayBackend = {
    create: (image, options, appName) => {
      const instance = makeInstance(image);
      created.push(instance);
      createOptions.push(options);
      createAppNames.push(appName);
      return instance;
    },
  };
  setTrayBackendForTesting(fake);
});

afterEach(() => {
  setTrayBackendForTesting(undefined);
});

describe('Tray construction', () => {
  test('is a Node EventEmitter for Electron compatibility', () => {
    expect(new Tray('/tmp/icon.png')).toBeInstanceOf(EventEmitter);
  });

  test('creates one native instance with the given image path', () => {
    new Tray('/tmp/icon.png');
    expect(created).toHaveLength(1);
    expect(created[0]?.image).toBe('/tmp/icon.png');
  });

  test("tells the backend the app's name", () => {
    app.setName('Notes Test');
    try {
      new Tray('/tmp/icon.png');
    } finally {
      app.resetForTesting();
    }
    expect(createAppNames).toEqual(['Notes Test']);
  });

  test('starts not destroyed', () => {
    expect(new Tray('/tmp/icon.png').isDestroyed()).toBe(false);
  });

  test('accepts a NativeImage by materializing its PNG to a temp file (Electron parity)', async () => {
    const { readFileSync } = await import('node:fs');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fakeImage = { toPNG: () => png, isTemplateImage: () => false } as unknown as TrayImage;
    const tray = new Tray(fakeImage);
    const path = created[0]?.image ?? '';
    expect(path.endsWith('icon.png')).toBe(true);
    expect(Array.from(readFileSync(path))).toEqual(Array.from(png));
    tray.destroy();
  });

  test('destroy removes the temp icon it materialized', async () => {
    const { existsSync } = await import('node:fs');
    const fakeImage = {
      toPNG: () => Buffer.from([0x89]),
      isTemplateImage: () => false,
    } as unknown as TrayImage;
    const tray = new Tray(fakeImage);
    const path = created[0]?.image ?? '';
    expect(existsSync(path)).toBe(true);
    tray.destroy();
    expect(existsSync(path)).toBe(false);
  });

  test('carries a NativeImage template flag to the backend', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fakeImage = { toPNG: () => png, isTemplateImage: () => true } as unknown as TrayImage;
    new Tray(fakeImage).destroy();
    expect(createOptions[0]).toEqual({ template: true });
    new Tray('/tmp/icon.png');
    expect(createOptions[1]).toEqual({});
  });
});

describe('Tray forwarding', () => {
  test('setToolTip forwards to the backend instance', () => {
    new Tray('/tmp/icon.png').setToolTip('Hello');
    expect(created[0]?.toolTips).toEqual(['Hello']);
  });

  test('setTitle forwards to the backend instance', () => {
    new Tray('/tmp/icon.png').setTitle('Status');
    expect(created[0]?.titles).toEqual(['Status']);
  });

  test('setImage forwards to the backend instance', () => {
    new Tray('/tmp/icon.png').setImage('/tmp/other.png');
    expect(created[0]?.images).toEqual(['/tmp/other.png']);
  });

  test('setContextMenu forwards a Menu to the backend instance', () => {
    const tray = new Tray('/tmp/icon.png');
    const menu = Menu.buildFromTemplate([{ label: 'Quit' }]);
    tray.setContextMenu(menu);
    expect(created[0]?.menus).toEqual([menu]);
  });

  test('setContextMenu forwards null to clear the menu', () => {
    const tray = new Tray('/tmp/icon.png');
    tray.setContextMenu(null);
    expect(created[0]?.menus).toEqual([null]);
  });
});

describe('Tray click event', () => {
  test('emits click when the backend reports the status item was activated', () => {
    const tray = new Tray('/tmp/icon.png');
    let fired = 0;
    tray.on('click', () => {
      fired += 1;
    });
    created[0]?.click?.();
    expect(fired).toBe(1);
  });
});

describe('Tray lifecycle', () => {
  test('destroy tears down the backend instance and flips isDestroyed', () => {
    const tray = new Tray('/tmp/icon.png');
    tray.destroy();
    expect(created[0]?.destroyed).toBe(true);
    expect(tray.isDestroyed()).toBe(true);
  });

  test('destroy is idempotent', () => {
    const tray = new Tray('/tmp/icon.png');
    tray.destroy();
    expect(() => tray.destroy()).not.toThrow();
    expect(tray.isDestroyed()).toBe(true);
  });

  test('forwarding methods are no-ops after destroy (do not throw)', () => {
    const tray = new Tray('/tmp/icon.png');
    tray.destroy();
    expect(() => tray.setToolTip('x')).not.toThrow();
    expect(() => tray.setTitle('x')).not.toThrow();
    expect(() => tray.setImage('/tmp/x.png')).not.toThrow();
    expect(() => tray.setContextMenu(null)).not.toThrow();
    expect(created[0]).toMatchObject({ toolTips: [], titles: [], images: [], menus: [] });
  });
});
